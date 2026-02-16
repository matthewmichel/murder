import { existsSync, rmSync } from "fs";
import { join } from "path";
import sql from "../lib/db.js";
import {
  getDefaultAgent,
  getAvailableAgents,
  dispatchAgent,
  type AgentBackend,
} from "../lib/dispatch.js";
import { preflightCheck } from "../lib/preflight.js";
import { monitorTask } from "../lib/heartbeat.js";
import { assembleProjectContext, formatContextForPrompt } from "../lib/context.js";
import {
  buildPmExplorePrompt,
  buildPmSynthesizePrompt,
  buildEmExplorePrompt,
  buildEmSynthesizePrompt,
} from "../lib/prompts.js";
import { promptSingleSelect, promptConfirm } from "../lib/prompt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(msg: string) {
  console.log(`  \u25CF ${msg}`);
}

function ok(msg: string) {
  console.log(`  \u2713 ${msg}\n`);
}

function fail(msg: string) {
  console.log(`  \u2717 ${msg}`);
}

function divider() {
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

// ---------------------------------------------------------------------------
// Project lookup
// ---------------------------------------------------------------------------

async function getProjectId(cwd: string): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM projects WHERE root_path = ${cwd} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return (rows[0] as unknown as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function learn() {
  const cwd = process.cwd();
  const learnStartedAt = Date.now();

  console.log("\n  Learn mode — building project knowledge...\n");

  // -----------------------------------------------------------------------
  // Setup: DB, project, agent, preflight, context
  // -----------------------------------------------------------------------

  step("Checking database connection...");
  try {
    await sql`SELECT 1`;
  } catch {
    fail("Could not connect to the database.");
    console.log("    Make sure murder is running (murder start).\n");
    process.exit(1);
    return;
  }
  ok("Connected");

  step("Checking project initialization...");
  const murderDir = join(cwd, ".murder");
  if (!existsSync(murderDir)) {
    fail("This project has not been initialized.");
    console.log('    Run "murder init" first to set up agent context.\n');
    await sql.end();
    process.exit(1);
    return;
  }

  const projectId = await getProjectId(cwd);
  if (!projectId) {
    fail("This project is not registered.");
    console.log('    Run "murder init" to register and initialize.\n');
    await sql.end();
    process.exit(1);
    return;
  }
  ok("Project initialized");

  step("Finding agent...");
  let agent: AgentBackend | null = await getDefaultAgent();

  if (!agent) {
    const agents = await getAvailableAgents();
    if (agents.length === 0) {
      fail("No AI coding agents available.");
      console.log("    Run 'murder start' to detect installed agents.\n");
      await sql.end();
      process.exit(1);
      return;
    }
    const items = agents.map((a) => ({ label: a.name }));
    const idx = await promptSingleSelect(items, "Select an agent:");
    agent = agents[idx];
  }
  ok(`Using ${agent.name}`);

  step(`Pre-flight check for ${agent.name}...`);
  const preflight = preflightCheck(agent, cwd);
  if (!preflight.ok) {
    fail(`${agent.name} failed pre-flight: ${preflight.message}`);
    console.log();
    await sql.end();
    process.exit(1);
    return;
  }
  ok(preflight.message);

  step("Assembling project context...");
  let ctx = assembleProjectContext(cwd);
  let contextBlock = formatContextForPrompt(ctx);

  const contextParts = [
    ctx.agentsMd && "AGENTS.md",
    ctx.architecture && "ARCHITECTURE.md",
    ctx.coreBeliefs && "core-beliefs.md",
    ctx.config && "config.ts",
    ctx.pmKnowledge && "PM.md",
    ctx.emKnowledge && "EM.md",
    ctx.futureDirection && "FUTURE.md",
  ].filter(Boolean);
  ok(`Loaded ${contextParts.length} context files (${contextParts.join(", ")})`);

  const questionsPath = join(murderDir, "QUESTIONS.md");
  const pmOutputPath = join(murderDir, "PM.md");
  const emOutputPath = join(murderDir, "EM.md");
  const futureOutputPath = join(murderDir, "FUTURE.md");

  // =====================================================================
  // PHASE 1: PM Exploration — generate questions
  // =====================================================================

  divider();
  console.log(`  PM Agent — exploring codebase`);
  console.log(`  ${agent.name} will analyze the project and`);
  console.log(`  generate questions for you at:`);
  console.log(`    ${questionsPath}`);
  divider();
  console.log();

  const pmExplorePrompt = buildPmExplorePrompt(contextBlock, questionsPath);

  const pmExploreHandle = await dispatchAgent(
    agent,
    pmExplorePrompt,
    cwd,
    projectId,
    "learn-pm-explore",
    { outputFormat: "stream-json" }
  );

  const pmExploreResult = await monitorTask(pmExploreHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  if (!existsSync(questionsPath)) {
    fail("PM agent did not create QUESTIONS.md.");
    if (pmExploreResult.diagnosis) {
      console.log(`    Diagnosis: ${pmExploreResult.diagnosis}`);
    }
    console.log(`    Log: ${pmExploreHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  ok("QUESTIONS.md generated");

  // =====================================================================
  // PHASE 2: User answers PM questions
  // =====================================================================

  divider();
  console.log(`  Your turn — answer the PM questions`);
  console.log();
  console.log(`  Open this file in your editor and answer the questions:`);
  console.log(`    ${questionsPath}`);
  console.log();
  console.log(`  Take your time. When you're done, come back here.`);
  divider();
  console.log();

  const pmProceed = await promptConfirm(
    "Have you finished answering the PM questions? Proceed?"
  );

  if (!pmProceed) {
    console.log("\n  Learn mode cancelled.\n");
    await sql.end();
    process.exit(0);
    return;
  }

  if (!existsSync(questionsPath)) {
    fail("QUESTIONS.md was deleted. Cannot proceed.");
    await sql.end();
    process.exit(1);
    return;
  }

  // =====================================================================
  // PHASE 3: PM Synthesis — create PM.md from answers
  // =====================================================================

  divider();
  console.log(`  PM Agent — synthesizing product knowledge`);
  console.log(`  ${agent.name} will read your answers and create:`);
  console.log(`    ${pmOutputPath}      (current state)`);
  console.log(`    ${futureOutputPath}  (future direction)`);
  divider();
  console.log();

  const pmSynthPrompt = buildPmSynthesizePrompt(
    contextBlock,
    questionsPath,
    pmOutputPath,
    futureOutputPath
  );

  const pmSynthHandle = await dispatchAgent(
    agent,
    pmSynthPrompt,
    cwd,
    projectId,
    "learn-pm-synthesize",
    { outputFormat: "stream-json" }
  );

  const pmSynthResult = await monitorTask(pmSynthHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  if (!existsSync(pmOutputPath)) {
    fail("PM agent did not create PM.md.");
    if (pmSynthResult.diagnosis) {
      console.log(`    Diagnosis: ${pmSynthResult.diagnosis}`);
    }
    console.log(`    Log: ${pmSynthHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  if (!existsSync(futureOutputPath)) {
    fail("PM agent did not create FUTURE.md.");
    console.log(`    Log: ${pmSynthHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  try {
    rmSync(questionsPath);
  } catch {}

  ok("PM.md + FUTURE.md created — QUESTIONS.md cleaned up");

  // Refresh context now that PM.md exists
  ctx = assembleProjectContext(cwd);
  contextBlock = formatContextForPrompt(ctx);

  // =====================================================================
  // PHASE 4: EM Exploration — generate engineering questions
  // =====================================================================

  divider();
  console.log(`  EM Agent — exploring codebase (engineering perspective)`);
  console.log(`  ${agent.name} will analyze the project and`);
  console.log(`  generate technical questions at:`);
  console.log(`    ${questionsPath}`);
  divider();
  console.log();

  const emExplorePrompt = buildEmExplorePrompt(contextBlock, questionsPath);

  const emExploreHandle = await dispatchAgent(
    agent,
    emExplorePrompt,
    cwd,
    projectId,
    "learn-em-explore",
    { outputFormat: "stream-json" }
  );

  const emExploreResult = await monitorTask(emExploreHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  if (!existsSync(questionsPath)) {
    fail("EM agent did not create QUESTIONS.md.");
    if (emExploreResult.diagnosis) {
      console.log(`    Diagnosis: ${emExploreResult.diagnosis}`);
    }
    console.log(`    Log: ${emExploreHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  ok("QUESTIONS.md generated (engineering)");

  // =====================================================================
  // PHASE 5: User answers EM questions
  // =====================================================================

  divider();
  console.log(`  Your turn — answer the EM questions`);
  console.log();
  console.log(`  Open this file in your editor and answer the questions:`);
  console.log(`    ${questionsPath}`);
  console.log();
  console.log(`  Take your time. When you're done, come back here.`);
  divider();
  console.log();

  const emProceed = await promptConfirm(
    "Have you finished answering the EM questions? Proceed?"
  );

  if (!emProceed) {
    console.log("\n  Learn mode cancelled.\n");
    try {
      rmSync(questionsPath);
    } catch {}
    await sql.end();
    process.exit(0);
    return;
  }

  if (!existsSync(questionsPath)) {
    fail("QUESTIONS.md was deleted. Cannot proceed.");
    await sql.end();
    process.exit(1);
    return;
  }

  // =====================================================================
  // PHASE 6: EM Synthesis — create EM.md from answers
  // =====================================================================

  divider();
  console.log(`  EM Agent — synthesizing engineering knowledge`);
  console.log(`  ${agent.name} will read your answers and create:`);
  console.log(`    ${emOutputPath}      (current state)`);
  console.log(`    ${futureOutputPath}  (update with eng items)`);
  divider();
  console.log();

  const emSynthPrompt = buildEmSynthesizePrompt(
    contextBlock,
    questionsPath,
    emOutputPath,
    futureOutputPath
  );

  const emSynthHandle = await dispatchAgent(
    agent,
    emSynthPrompt,
    cwd,
    projectId,
    "learn-em-synthesize",
    { outputFormat: "stream-json" }
  );

  const emSynthResult = await monitorTask(emSynthHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  if (!existsSync(emOutputPath)) {
    fail("EM agent did not create EM.md.");
    if (emSynthResult.diagnosis) {
      console.log(`    Diagnosis: ${emSynthResult.diagnosis}`);
    }
    console.log(`    Log: ${emSynthHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  try {
    rmSync(questionsPath);
  } catch {}

  ok("EM.md created — QUESTIONS.md cleaned up");

  // =====================================================================
  // Done
  // =====================================================================

  const elapsed = Date.now() - learnStartedAt;

  divider();
  console.log(`  Learn mode complete (${formatDuration(elapsed)})`);
  console.log();
  console.log(`  Knowledge files created/updated:`);
  console.log(`    .murder/PM.md           — product knowledge (current state)`);
  console.log(`    .murder/EM.md           — engineering knowledge (current state)`);
  console.log(`    .murder/FUTURE.md       — future direction & roadmap`);
  console.log(`    AGENTS.md               — may have been updated`);
  console.log(`    .murder/ARCHITECTURE.md — may have been updated`);
  console.log(`    .murder/core-beliefs.md — may have been updated`);
  console.log();
  console.log(`  These files will automatically be included in future`);
  console.log(`  agent prompts for better decision-making.`);
  divider();
  console.log();

  await sql.end();
}
