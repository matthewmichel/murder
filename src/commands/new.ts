import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  buildPmPrompt,
  buildEmPrompt,
  buildPostMortemPmPrompt,
} from "../lib/prompts.js";
import type { PostMortemMeta } from "../lib/prompts.js";
import { promptSingleSelect } from "../lib/prompt.js";
import { runEmLoop } from "../lib/em-loop.js";
import {
  ensureGitRepo,
  ensureCleanWorktree,
  createFeatureBranch,
  setupWorktree,
  cleanupWorktree,
  createPullRequest,
  featureBranchName,
} from "../lib/worktree.js";

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

// ---------------------------------------------------------------------------
// AI-powered slug generation
// ---------------------------------------------------------------------------

function extractNameFromStreamJson(rawOutput: string): string | null {
  const lines = rawOutput.split("\n").filter((l) => l.trim());
  const textParts: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      if (
        event.type === "system" ||
        event.type === "tool_call" ||
        event.type === "result"
      ) {
        continue;
      }

      const text =
        (typeof event.content === "string" ? event.content : null) ||
        (typeof event.text === "string" ? event.text : null) ||
        (typeof event.delta === "string" ? event.delta : null) ||
        (event.message?.content &&
        typeof event.message.content === "string"
          ? event.message.content
          : null) ||
        (event.assistant_message?.content &&
        typeof event.assistant_message.content === "string"
          ? event.assistant_message.content
          : null);

      if (text) {
        textParts.push(text);
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return textParts.join("").trim() || null;
}

async function runQuickAgent(
  agent: AgentBackend,
  prompt: string,
  cwd: string
): Promise<string | null> {
  const logsDir = join(cwd, ".murder", "logs");
  mkdirSync(logsDir, { recursive: true });

  const tmpId = `name-${Date.now()}`;
  const promptPath = join(logsDir, `${tmpId}.prompt`);
  writeFileSync(promptPath, prompt, "utf-8");

  const modelFlag =
    agent.preferred_model && agent.preferred_model !== "auto"
      ? `--model '${agent.preferred_model.replace(/'/g, "'\\''")}' `
      : "";

  const cmd = `${agent.cli_command} ${modelFlag}-p --force --output-format stream-json "$(cat '${promptPath}')"`;

  return new Promise<string | null>((resolve) => {
    const proc = spawn("/bin/sh", ["-c", cmd], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    proc.stdin?.end();

    let allOutput = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      allOutput += chunk.toString();
    });

    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      try {
        rmSync(promptPath);
      } catch {}
      resolve(null);
    }, 30_000);

    proc.on("close", () => {
      clearTimeout(timeout);
      try {
        rmSync(promptPath);
      } catch {}
      resolve(extractNameFromStreamJson(allOutput));
    });

    proc.on("error", () => {
      clearTimeout(timeout);
      try {
        rmSync(promptPath);
      } catch {}
      resolve(null);
    });
  });
}

async function generateSlugFromAgent(
  agent: AgentBackend,
  userPrompt: string,
  cwd: string
): Promise<string> {
  const timestamp = Date.now();

  const namePrompt =
    "Generate a short, git-friendly branch name for the following task. " +
    "Only output the generated name and nothing else. " +
    "No quotes, no backticks, no explanation. " +
    "Lowercase, hyphens between words, max 4 words.\n\n" +
    `Task: ${userPrompt}`;

  try {
    const name = await runQuickAgent(agent, namePrompt, cwd);

    if (name) {
      const cleaned = name
        .split("\n")[0]
        .trim()
        .toLowerCase()
        .replace(/[`'"]/g, "")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-+/g, "-")
        .slice(0, 40);

      if (cleaned.length >= 3) {
        return `${cleaned}-${timestamp}`;
      }
    }
  } catch {
    // Fall through to fallback
  }

  return `${slugify(userPrompt)}-${timestamp}`;
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

  const taskStartedAt = new Date().toISOString();
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

  // Step 6: Generate project name using agent
  step("Generating project name...");
  const slug = await generateSlugFromAgent(agent, prompt, cwd);
  ok(`Name: ${slug}`);

  // Step 7: Git setup — create feature branch + worktree BEFORE planning
  step("Checking git repository...");
  try {
    ensureGitRepo(cwd);
  } catch (err) {
    fail((err as Error).message);
    await sql.end();
    process.exit(1);
    return;
  }
  ensureCleanWorktree(cwd);
  ok("Git repo ready");

  step("Creating feature branch...");
  const featureBranch = createFeatureBranch(cwd, slug);
  ok(`Branch: ${featureBranch}`);

  step("Setting up worktree...");
  const workDir = setupWorktree(cwd, slug);
  ok(`Worktree: ${workDir}`);

  // Step 8: Create exec plan directory INSIDE the worktree
  const planDir = join(workDir, ".murder", "exec-plans", "active", slug);
  mkdirSync(planDir, { recursive: true });

  const prdPath = join(planDir, "prd.md");
  const planPath = join(planDir, "plan.md");
  const progressPath = join(planDir, "progress.json");

  // -----------------------------------------------------------------------
  // Phase 1: PM Agent — generate PRD (working in the worktree)
  // -----------------------------------------------------------------------
  divider();
  console.log(`  PM Agent \u2014 generating PRD`);
  console.log(`  ${agent.name} will analyze your request and`);
  console.log(`  write a PRD to:`);
  console.log(`    ${prdPath}`);
  divider();
  console.log();

  const pmPrompt = buildPmPrompt(prompt, contextBlock, prdPath);

  const pmHandle = await dispatchAgent(
    agent,
    pmPrompt,
    workDir,
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
  // Phase 2: EM Agent — generate execution plan + progress.json (in worktree)
  // -----------------------------------------------------------------------
  divider();
  console.log(`  EM Agent \u2014 generating execution plan`);
  console.log(`  ${agent.name} will read the PRD and create:`);
  console.log(`    ${planPath}`);
  console.log(`    ${progressPath}`);
  divider();
  console.log();

  const emPrompt = buildEmPrompt(prdPath, contextBlock, planPath, progressPath, slug);

  const emHandle = await dispatchAgent(
    agent,
    emPrompt,
    workDir,
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
  // Phase 3: EM Loop — execute the plan (engineer + review in worktree)
  // -----------------------------------------------------------------------
  divider();
  console.log("  Starting EM Loop \u2014 executing the plan");
  console.log("  Engineer works in the worktree, EM reviews each phase.");
  divider();
  console.log();

  const loopResult = await runEmLoop({
    planDir,
    workDir,
    cwd,
    projectId,
    agent,
    slug,
    projectContext: contextBlock,
    prdPath,
  });

  if (loopResult.status === "failed") {
    fail("Engineering loop failed. Skipping post-mortem.");
    console.log(`    ${loopResult.phasesCompleted}/${loopResult.totalPhases} phases completed.`);
    console.log(`    Elapsed: ${formatDuration(loopResult.totalElapsedMs)}\n`);
    await sql.end();
    process.exit(1);
    return;
  }

  // -----------------------------------------------------------------------
  // Phase 4: Post-mortem PM Agent — evaluate and document
  // -----------------------------------------------------------------------
  const taskCompletedAt = new Date().toISOString();

  divider();
  console.log("  Post-mortem PM Agent \u2014 documenting results");
  divider();
  console.log();

  const filesOutputPath = join(planDir, "files.md");
  const notesOutputPath = join(planDir, "notes.md");
  const metadataOutputPath = join(planDir, "metadata.json");

  const progressContent = readFileSync(progressPath, "utf-8");
  const planContent = readFileSync(planPath, "utf-8");
  const prdContent = readFileSync(prdPath, "utf-8");

  const meta: PostMortemMeta = {
    slug,
    branch: featureBranchName(slug),
    agentName: agent.name,
    startedAt: taskStartedAt,
    completedAt: taskCompletedAt,
    totalElapsedMs: loopResult.totalElapsedMs,
    phasesCompleted: loopResult.phasesCompleted,
    totalPhases: loopResult.totalPhases,
    status: loopResult.status,
  };

  const postMortemPrompt = buildPostMortemPmPrompt(
    progressContent,
    planContent,
    prdContent,
    contextBlock,
    meta,
    filesOutputPath,
    notesOutputPath,
    metadataOutputPath
  );

  const pmPostHandle = await dispatchAgent(
    agent,
    postMortemPrompt,
    workDir,
    projectId,
    "post-mortem-pm",
    { outputFormat: "stream-json" }
  );

  const pmPostResult = await monitorTask(pmPostHandle, {
    outputTimeoutMs: 120_000,
    checkIntervalMs: 5_000,
    projectId,
    outputFormat: "stream-json",
  });

  console.log();

  if (!existsSync(filesOutputPath) || !existsSync(notesOutputPath) || !existsSync(metadataOutputPath)) {
    console.log("    Post-mortem agent did not create all expected files.");
    if (pmPostResult.diagnosis) console.log(`    Diagnosis: ${pmPostResult.diagnosis}`);
    console.log(`    Log: ${pmPostHandle.logPath}`);
    console.log("    Continuing with cleanup...\n");
  } else {
    ok("Post-mortem artifacts generated");
  }

  // -----------------------------------------------------------------------
  // Phase 5: Cleanup intermediate files, commit, worktree teardown, PR
  // -----------------------------------------------------------------------
  divider();
  console.log("  Cleaning up and finalizing");
  divider();
  console.log();

  // Remove intermediate artifacts: notes/, plan.md, progress.json
  const notesDir = join(planDir, "notes");
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
  if (existsSync(planPath)) {
    rmSync(planPath);
  }
  if (existsSync(progressPath)) {
    rmSync(progressPath);
  }
  ok("Intermediate files removed (notes/, plan.md, progress.json)");

  // Cleanup worktree
  step("Cleaning up worktree...");
  try {
    cleanupWorktree(cwd);
    ok("Worktree removed");
  } catch {
    console.log("    Could not remove worktree automatically. Clean up manually.\n");
  }

  // Create PR
  step("Creating pull request...");
  try {
    const pr = createPullRequest(cwd, slug, `murder new: ${slug}`);
    if (pr.url) {
      ok(`PR created: ${pr.url}`);
    } else {
      ok("Branch pushed (create PR manually)");
    }
  } catch (err) {
    console.log(`    Could not create PR: ${(err as Error).message}`);
    console.log(`    Create one manually from branch: murder/${slug}\n`);
  }

  divider();
  console.log(`\n  Task complete: ${slug}`);
  console.log(`  Total time: ${formatDuration(Date.now() - new Date(taskStartedAt).getTime())}`);
  divider();
  console.log();

  await sql.end();
}
