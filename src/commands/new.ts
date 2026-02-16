import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import sql from "../lib/db.js";
import {
  getDefaultAgent,
  getAvailableAgents,
  dispatchAgent,
} from "../lib/dispatch.js";
import { preflightCheck } from "../lib/preflight.js";
import { monitorTask } from "../lib/heartbeat.js";
import { assembleProjectContext, formatContextForPrompt } from "../lib/context.js";
import { buildPmPrompt, buildEmPrompt } from "../lib/prompts.js";
import { promptSingleSelect } from "../lib/prompt.js";
import { runEmLoop } from "../lib/em-loop.js";

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
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

export async function newTask() {
  const cwd = process.cwd();
  const prompt = process.argv.slice(3).join(" ").trim();

  if (!prompt) {
    fail("No prompt provided.");
    console.log('  Usage: murder new "<description of what you want to build>"\n');
    process.exit(1);
    return;
  }

  console.log("\n  Planning new task...\n");

  // Step 1: Check database
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

  // Step 2: Verify project is initialized
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

  // Step 3: Get agent
  step("Finding agent...");
  let agent = await getDefaultAgent();

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

  // Step 4: Pre-flight check
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

  // Step 5: Assemble project context
  step("Assembling project context...");
  const ctx = assembleProjectContext(cwd);
  const contextBlock = formatContextForPrompt(ctx);

  const contextParts = [
    ctx.agentsMd && "AGENTS.md",
    ctx.architecture && "ARCHITECTURE.md",
    ctx.coreBeliefs && "core-beliefs.md",
    ctx.config && "config.ts",
  ].filter(Boolean);
  ok(`Loaded ${contextParts.length} context files (${contextParts.join(", ")})`);

  // Step 6: Create exec plan directory
  const slug = slugify(prompt);
  const planDir = join(murderDir, "exec-plans", "active", slug);
  mkdirSync(planDir, { recursive: true });

  const prdPath = join(planDir, "prd.md");
  const planPath = join(planDir, "plan.md");
  const progressPath = join(planDir, "progress.json");

  // -----------------------------------------------------------------------
  // Phase 1: PM Agent — generate PRD
  // -----------------------------------------------------------------------
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  PM Agent \u2014 generating PRD`);
  console.log(`  ${agent.name} will analyze your request and`);
  console.log(`  write a PRD to:`);
  console.log(`    ${prdPath}`);
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  const pmPrompt = buildPmPrompt(prompt, contextBlock, prdPath);

  const pmHandle = await dispatchAgent(
    agent,
    pmPrompt,
    cwd,
    projectId,
    "new-pm",
    { outputFormat: "stream-json" }
  );

  const pmResult = await monitorTask(pmHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  if (!existsSync(prdPath)) {
    fail("PM agent did not create the PRD.");
    if (pmResult.diagnosis) {
      console.log(`    Diagnosis: ${pmResult.diagnosis}`);
    }
    console.log(`    Log: ${pmHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  ok("PRD generated");

  // -----------------------------------------------------------------------
  // Phase 2: EM Agent — generate execution plan + progress.json
  // -----------------------------------------------------------------------
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  EM Agent \u2014 generating execution plan`);
  console.log(`  ${agent.name} will read the PRD and create:`);
  console.log(`    ${planPath}`);
  console.log(`    ${progressPath}`);
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  const emPrompt = buildEmPrompt(prdPath, contextBlock, planPath, progressPath, slug);

  const emHandle = await dispatchAgent(
    agent,
    emPrompt,
    cwd,
    projectId,
    "new-em",
    { outputFormat: "stream-json" }
  );

  const emResult = await monitorTask(emHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  // Verify both plan.md and progress.json were created
  const planCreated = existsSync(planPath);
  const progressCreated = existsSync(progressPath);

  if (!planCreated) {
    fail("EM agent did not create the execution plan.");
    if (emResult.diagnosis) console.log(`    Diagnosis: ${emResult.diagnosis}`);
    console.log(`    Log: ${emHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  if (!progressCreated) {
    fail("EM agent did not create progress.json.");
    console.log("    The execution plan was created but the progress tracker is missing.");
    console.log(`    Log: ${emHandle.logPath}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  ok("Execution plan + progress tracker generated");

  // -----------------------------------------------------------------------
  // Phase 3: EM Loop — execute the plan
  // -----------------------------------------------------------------------
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log("  Starting EM Loop \u2014 executing the plan");
  console.log("  Engineer works in a git worktree, EM reviews each phase.");
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  await runEmLoop({
    planDir,
    cwd,
    projectId,
    agent,
    slug,
    projectContext: contextBlock,
    prdPath,
  });

  await sql.end();
}
