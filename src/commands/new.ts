import { spawn } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import sql from "../lib/db.js";
import {
  getDefaultAgent,
  getAvailableAgents,
  type AgentBackend,
} from "../lib/dispatch.js";
import { preflightCheck } from "../lib/preflight.js";
import { assembleProjectContext, formatContextForPrompt } from "../lib/context.js";
import { promptSingleSelect } from "../lib/prompt.js";
import { runNewTaskProgrammatic } from "../lib/run-new-task.js";
import { step, ok, fail, divider, slugify, formatDuration, getProjectId } from "../lib/cli-utils.js";

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

  const taskStartedAt = Date.now();
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
  formatContextForPrompt(ctx);

  const contextParts = [
    ctx.agentsMd && "AGENTS.md",
    ctx.architecture && "ARCHITECTURE.md",
    ctx.coreBeliefs && "core-beliefs.md",
    ctx.config && "config.ts",
    ctx.pmMd && "PM.md",
    ctx.emMd && "EM.md",
    ctx.futureMd && "FUTURE.md",
  ].filter(Boolean);
  ok(`Found ${contextParts.length} knowledge files (${contextParts.join(", ")})`);

  // Step 6: Generate project name using agent
  step("Generating project name...");
  const slug = await generateSlugFromAgent(agent, prompt, cwd);
  ok(`Name: ${slug}`);

  // -----------------------------------------------------------------------
  // Delegate pipeline to runNewTaskProgrammatic()
  // -----------------------------------------------------------------------
  divider();
  console.log("  Starting pipeline (PM → EM → Engineer → Post-mortem)");
  divider();
  console.log();

  const result = await runNewTaskProgrammatic({
    prompt,
    projectId,
    projectRootPath: cwd,
    slug,
    agent,
    prTitlePrefix: "murder new",
  });

  // -----------------------------------------------------------------------
  // Handle result
  // -----------------------------------------------------------------------
  if (result.status === "failed") {
    fail(`Pipeline failed: ${result.error ?? "unknown error"}`);
    console.log();
    await sql.end();
    process.exit(1);
    return;
  }

  divider();
  console.log(`\n  Task complete: ${slug}`);
  if (result.prUrl) {
    console.log(`  PR: ${result.prUrl}`);
  } else if (result.branchName) {
    console.log(`  Branch: ${result.branchName} (create PR manually)`);
  }
  console.log(`  Total time: ${formatDuration(Date.now() - taskStartedAt)}`);
  divider();
  console.log();

  await sql.end();
}
