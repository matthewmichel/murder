import { readFileSync } from "fs";
import { join } from "path";
import type { AgentBackend } from "./dispatch.js";
import { dispatchAgent } from "./dispatch.js";
import { monitorTask } from "./heartbeat.js";
import {
  readProgress,
  writeProgress,
  getCurrentPhase,
  isAllComplete,
  markEngineerStatus,
  markPhaseStatus,
  markReviewStatus,
  advancePhase,
} from "./progress.js";
import {
  ensureGitRepo,
  ensureCleanWorktree,
  createFeatureBranch,
  setupWorktree,
  cleanupWorktree,
  createPullRequest,
} from "./worktree.js";
import {
  buildEngineerPrompt,
  buildEmReviewPrompt,
  engineerNotesPath,
} from "./prompts.js";

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
// Main EM Loop — single engineer, phased execution with manager review
// ---------------------------------------------------------------------------

export interface EmLoopOptions {
  planDir: string;
  cwd: string;
  projectId: string;
  agent: AgentBackend;
  slug: string;
  projectContext: string;
  prdPath: string;
}

export async function runEmLoop(options: EmLoopOptions): Promise<void> {
  const { planDir, cwd, projectId, agent, slug, projectContext, prdPath } = options;
  const progressPath = join(planDir, "progress.json");

  const prdContent = readFileSync(prdPath, "utf-8");

  // -----------------------------------------------------------------------
  // Git setup
  // -----------------------------------------------------------------------
  step("Checking git repository...");
  try {
    ensureGitRepo(cwd);
  } catch (err) {
    fail((err as Error).message);
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

  // -----------------------------------------------------------------------
  // Phase loop
  // -----------------------------------------------------------------------
  const loopStart = Date.now();
  let progress = readProgress(progressPath);
  progress.status = "in_progress";
  progress.startedAt = new Date().toISOString();
  writeProgress(progressPath, progress);

  while (!isAllComplete(progress)) {
    const phase = getCurrentPhase(progress);
    if (!phase) break;

    const phaseIdx = progress.currentPhase;
    const phaseNum = phase.number;

    divider();
    console.log(`  Phase ${phaseNum}: ${phase.name}`);
    console.log(`  Dispatching Engineer`);
    divider();
    console.log();

    // Mark phase as in progress
    markPhaseStatus(progress, phaseIdx, "in_progress");
    writeProgress(progressPath, progress);

    // Build prompt
    const notesPath = engineerNotesPath(planDir);
    const prompt = buildEngineerPrompt(phase, prdContent, projectContext, notesPath);

    // Dispatch engineer
    markEngineerStatus(progress, phaseIdx, "in_progress");
    writeProgress(progressPath, progress);

    const handle = await dispatchAgent(
      agent,
      prompt,
      workDir,
      projectId,
      `eng-phase-${phaseNum}`,
      { outputFormat: "stream-json" }
    );

    markEngineerStatus(progress, phaseIdx, "in_progress", handle.taskId);
    writeProgress(progressPath, progress);

    console.log(`    Engineer PID: ${handle.pid}  Log: ${handle.logPath}`);
    console.log();

    // Monitor
    const phaseStart = Date.now();

    const result = await monitorTask(handle, {
      outputTimeoutMs: 300_000,
      checkIntervalMs: 10_000,
      projectId,
      outputFormat: "stream-json",
    });

    const phaseElapsed = formatDuration(Date.now() - phaseStart);

    const engStatus = result.status === "completed" ? "completed" as const : "failed" as const;
    markEngineerStatus(progress, phaseIdx, engStatus);
    writeProgress(progressPath, progress);

    console.log(`    Engineer: ${engStatus} (exit ${result.exitCode})`);
    console.log(`    Phase ${phaseNum} engineering: ${phaseElapsed}\n`);

    // If failed, stop
    if (engStatus === "failed") {
      markPhaseStatus(progress, phaseIdx, "failed");
      progress.status = "failed";
      writeProgress(progressPath, progress);

      fail(`Phase ${phaseNum} failed.`);
      console.log(`    Log: ${handle.logPath}`);
      if (result.diagnosis) console.log(`    Diagnosis: ${result.diagnosis}`);
      console.log();
      return;
    }

    ok("Engineer completed");

    // -------------------------------------------------------------------
    // EM Review Agent
    // -------------------------------------------------------------------
    divider();
    console.log(`  EM Review: Phase ${phaseNum}`);
    divider();
    console.log();

    markReviewStatus(progress, phaseIdx, "in_progress");
    writeProgress(progressPath, progress);

    const reviewPrompt = buildEmReviewPrompt(phase, slug, phaseNum, projectContext);

    const reviewHandle = await dispatchAgent(
      agent,
      reviewPrompt,
      workDir,
      projectId,
      `em-review-phase-${phaseNum}`,
      { outputFormat: "stream-json" }
    );

    markReviewStatus(progress, phaseIdx, "in_progress", reviewHandle.taskId);
    writeProgress(progressPath, progress);

    const reviewResult = await monitorTask(reviewHandle, {
      outputTimeoutMs: 120_000,
      checkIntervalMs: 5_000,
      projectId,
      outputFormat: "stream-json",
    });

    const reviewStatus = reviewResult.status === "completed" ? "completed" as const : "failed" as const;
    markReviewStatus(progress, phaseIdx, reviewStatus);

    if (reviewStatus === "failed") {
      console.log(`\n    EM review failed. Log: ${reviewHandle.logPath}`);
      if (reviewResult.diagnosis) console.log(`    Diagnosis: ${reviewResult.diagnosis}`);
      markPhaseStatus(progress, phaseIdx, "failed");
      progress.status = "failed";
      writeProgress(progressPath, progress);
      console.log();
      return;
    }

    console.log();
    ok(`Phase ${phaseNum} complete`);

    // Advance to next phase
    markPhaseStatus(progress, phaseIdx, "completed");
    advancePhase(progress);
    writeProgress(progressPath, progress);
  }

  // -----------------------------------------------------------------------
  // All phases complete
  // -----------------------------------------------------------------------
  const totalElapsed = formatDuration(Date.now() - loopStart);

  divider();
  console.log("  All phases complete!\n");
  console.log(`  Total time: ${totalElapsed}`);
  console.log(`  Phases completed: ${progress.phases.length}`);

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
  console.log();
}
