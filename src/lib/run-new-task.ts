import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import sql from "./db.js";
import { getDefaultAgent, getAvailableAgents, dispatchAgent } from "./dispatch.js";
import type { AgentBackend } from "./dispatch.js";
import { preflightCheck } from "./preflight.js";
import { monitorTask } from "./heartbeat.js";
import { assembleProjectContext, formatContextForPrompt } from "./context.js";
import {
  buildPmPrompt,
  buildEmPrompt,
  buildPostMortemPmPrompt,
} from "./prompts.js";
import type { PostMortemMeta } from "./prompts.js";
import { runEmLoop } from "./em-loop.js";
import {
  ensureGitRepo,
  ensureCleanWorktree,
  createFeatureBranch,
  setupWorktree,
  cleanupWorktree,
  createPullRequest,
  featureBranchName,
} from "./worktree.js";
import { formatDuration } from "./cli-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunNewTaskOptions {
  prompt: string;
  projectId: string;
  projectRootPath: string;
  slug: string;
  agentSlug?: string;
  /** Pass a resolved agent directly (skips agentSlug lookup) */
  agent?: AgentBackend;
  /** Prefix for the PR title — defaults to "murder job" */
  prTitlePrefix?: string;
}

export interface RunNewTaskResult {
  status: "completed" | "failed";
  branchName: string | null;
  prUrl: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main programmatic pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full `murder new` pipeline programmatically without interactive
 * prompts. Designed for use by the job executor.
 *
 * Does NOT call process.exit() — throws or returns error status instead.
 */
export async function runNewTaskProgrammatic(
  options: RunNewTaskOptions
): Promise<RunNewTaskResult> {
  const { prompt, projectId, projectRootPath, slug } = options;
  const cwd = projectRootPath;
  const taskStartedAt = new Date().toISOString();
  const prTitlePrefix = options.prTitlePrefix ?? "murder job";

  // Step 1: Verify database connection
  try {
    await sql`SELECT 1`;
  } catch {
    throw new Error("Could not connect to the database. Is murder running?");
  }

  // Step 2: Verify project is initialized
  const murderDir = join(cwd, ".murder");
  if (!existsSync(murderDir)) {
    throw new Error(`Project at ${cwd} has not been initialized. Run "murder init" first.`);
  }

  // Step 3: Get agent
  let agent: AgentBackend | null = options.agent ?? null;

  if (!agent && options.agentSlug) {
    const agents = await getAvailableAgents();
    agent = agents.find((a) => a.slug === options.agentSlug) ?? null;
    if (!agent) {
      throw new Error(`Agent "${options.agentSlug}" not found or not available.`);
    }
  } else if (!agent) {
    agent = await getDefaultAgent();
    if (!agent) {
      const agents = await getAvailableAgents();
      if (agents.length === 0) {
        throw new Error("No AI coding agents available. Run 'murder start' to detect installed agents.");
      }
      agent = agents[0];
    }
  }

  // Step 4: Pre-flight check
  const preflight = preflightCheck(agent, cwd);
  if (!preflight.ok) {
    throw new Error(`${agent.name} failed pre-flight: ${preflight.message}`);
  }

  // Step 5: Assemble project context
  const ctx = assembleProjectContext(cwd);
  const contextBlock = formatContextForPrompt(ctx);

  // Step 6: Git setup
  const branchName = featureBranchName(slug);

  try {
    ensureGitRepo(cwd);
  } catch (err) {
    throw new Error(`Git error: ${(err as Error).message}`);
  }
  ensureCleanWorktree(cwd);

  createFeatureBranch(cwd, slug);
  const workDir = setupWorktree(cwd, slug);

  // Step 7: Create exec plan directory inside the worktree
  const planDir = join(workDir, ".murder", "exec-plans", "active", slug);
  mkdirSync(planDir, { recursive: true });

  const prdPath = join(planDir, "prd.md");
  const planPath = join(planDir, "plan.md");
  const progressPath = join(planDir, "progress.json");

  try {
    // Phase 1: PM Agent — generate PRD
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

    if (!existsSync(prdPath)) {
      const diag = pmResult.diagnosis ? ` Diagnosis: ${pmResult.diagnosis}` : "";
      return {
        status: "failed",
        branchName,
        prUrl: null,
        error: `PM agent did not create the PRD.${diag}`,
      };
    }

    // Phase 2: EM Agent — generate execution plan
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

    if (!existsSync(planPath)) {
      const diag = emResult.diagnosis ? ` Diagnosis: ${emResult.diagnosis}` : "";
      return {
        status: "failed",
        branchName,
        prUrl: null,
        error: `EM agent did not create the execution plan.${diag}`,
      };
    }

    if (!existsSync(progressPath)) {
      return {
        status: "failed",
        branchName,
        prUrl: null,
        error: "EM agent did not create progress.json.",
      };
    }

    // Phase 3: EM Loop — execute the plan
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
      return {
        status: "failed",
        branchName,
        prUrl: null,
        error: `Engineering loop failed. ${loopResult.phasesCompleted}/${loopResult.totalPhases} phases completed.`,
      };
    }

    // Phase 4: Post-mortem PM Agent
    const taskCompletedAt = new Date().toISOString();
    const filesOutputPath = join(planDir, "files.md");
    const notesOutputPath = join(planDir, "notes.md");
    const metadataOutputPath = join(planDir, "metadata.json");

    const progressContent = readFileSync(progressPath, "utf-8");
    const planContent = readFileSync(planPath, "utf-8");
    const prdContent = readFileSync(prdPath, "utf-8");

    const meta: PostMortemMeta = {
      slug,
      branch: branchName,
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

    await dispatchAgent(
      agent,
      postMortemPrompt,
      workDir,
      projectId,
      "post-mortem-pm",
      { outputFormat: "stream-json" }
    ).then((handle) =>
      monitorTask(handle, {
        outputTimeoutMs: 120_000,
        checkIntervalMs: 5_000,
        projectId,
        outputFormat: "stream-json",
      })
    );

    // Phase 5: Cleanup intermediate files
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

    // Cleanup worktree
    try {
      cleanupWorktree(cwd);
    } catch {
      // non-critical
    }

    // Create PR
    let prUrl: string | null = null;
    try {
      const pr = createPullRequest(cwd, slug, `${prTitlePrefix}: ${slug}`);
      prUrl = pr.url;
    } catch {
      // PR creation failed — non-critical
    }

    return {
      status: "completed",
      branchName,
      prUrl,
    };
  } catch (err) {
    // Attempt worktree cleanup on unexpected errors
    try {
      cleanupWorktree(cwd);
    } catch {
      // ignore cleanup errors
    }

    return {
      status: "failed",
      branchName,
      prUrl: null,
      error: (err as Error).message,
    };
  }
}
