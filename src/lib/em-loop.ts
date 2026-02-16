import { readFileSync, existsSync } from "fs";
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
  setupWorktrees,
  setupPhaseBranches,
  mergePhaseBranches,
  cleanupWorktrees,
  createPullRequest,
  worktreeDir,
} from "./worktree.js";
import {
  buildEngineerPrompt,
  buildEmReviewPrompt,
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
// Main EM Loop
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

  // Read PRD content for engineer prompts
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

  step("Setting up worktrees...");
  const worktrees = setupWorktrees(cwd, slug);
  ok(`Eng A: ${worktrees.engA}\n    Eng B: ${worktrees.engB}`);

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
    console.log(`  Dispatching Engineer A + Engineer B in parallel`);
    divider();
    console.log();

    // Setup branches for this phase
    if (phaseNum > 1) {
      step(`Setting up branches for Phase ${phaseNum}...`);
      setupPhaseBranches(cwd, slug, phaseNum);
      ok("Phase branches ready");
    }

    // Mark phase as in progress
    markPhaseStatus(progress, phaseIdx, "in_progress");
    writeProgress(progressPath, progress);

    // Build prompts
    const promptA = buildEngineerPrompt("A", phase, prdContent, projectContext);
    const promptB = buildEngineerPrompt("B", phase, prdContent, projectContext);

    // Dispatch both engineers in parallel
    markEngineerStatus(progress, phaseIdx, "A", "in_progress");
    markEngineerStatus(progress, phaseIdx, "B", "in_progress");
    writeProgress(progressPath, progress);

    const engADir = join(worktreeDir(cwd), "eng-a");
    const engBDir = join(worktreeDir(cwd), "eng-b");

    const [handleA, handleB] = await Promise.all([
      dispatchAgent(agent, promptA, engADir, projectId, `eng-a-phase-${phaseNum}`, { outputFormat: "stream-json", label: "Eng A" }),
      dispatchAgent(agent, promptB, engBDir, projectId, `eng-b-phase-${phaseNum}`, { outputFormat: "stream-json", label: "Eng B" }),
    ]);

    markEngineerStatus(progress, phaseIdx, "A", "in_progress", handleA.taskId);
    markEngineerStatus(progress, phaseIdx, "B", "in_progress", handleB.taskId);
    writeProgress(progressPath, progress);

    console.log(`    Eng A PID: ${handleA.pid}  Log: ${handleA.logPath}`);
    console.log(`    Eng B PID: ${handleB.pid}  Log: ${handleB.logPath}`);
    console.log();

    // Monitor both in parallel — stream-json events display interleaved with labels
    const phaseStart = Date.now();

    const [resultA, resultB] = await Promise.all([
      monitorTask(handleA, {
        outputTimeoutMs: 300_000,
        checkIntervalMs: 10_000,
        projectId,
        outputFormat: "stream-json",
      }),
      monitorTask(handleB, {
        outputTimeoutMs: 300_000,
        checkIntervalMs: 10_000,
        projectId,
        outputFormat: "stream-json",
      }),
    ]);

    const phaseElapsed = formatDuration(Date.now() - phaseStart);

    // Update engineer statuses
    const engAStatus = resultA.status === "completed" ? "completed" as const : "failed" as const;
    const engBStatus = resultB.status === "completed" ? "completed" as const : "failed" as const;

    markEngineerStatus(progress, phaseIdx, "A", engAStatus);
    markEngineerStatus(progress, phaseIdx, "B", engBStatus);
    writeProgress(progressPath, progress);

    console.log(`    Eng A: ${engAStatus} (exit ${resultA.exitCode})`);
    console.log(`    Eng B: ${engBStatus} (exit ${resultB.exitCode})`);
    console.log(`    Phase ${phaseNum} engineering: ${phaseElapsed}\n`);

    // If either failed, stop
    if (engAStatus === "failed" || engBStatus === "failed") {
      markPhaseStatus(progress, phaseIdx, "failed");
      progress.status = "failed";
      writeProgress(progressPath, progress);

      fail(`Phase ${phaseNum} failed.`);
      if (engAStatus === "failed") {
        console.log(`    Eng A log: ${handleA.logPath}`);
        if (resultA.diagnosis) console.log(`    Diagnosis: ${resultA.diagnosis}`);
      }
      if (engBStatus === "failed") {
        console.log(`    Eng B log: ${handleB.logPath}`);
        if (resultB.diagnosis) console.log(`    Diagnosis: ${resultB.diagnosis}`);
      }
      console.log();
      return;
    }

    ok("Both engineers completed");

    // -------------------------------------------------------------------
    // Merge phase branches into feature branch
    // -------------------------------------------------------------------
    step(`Merging Phase ${phaseNum} branches into feature branch...`);
    const mergeResult = mergePhaseBranches(cwd, slug, phaseNum);

    if (mergeResult.clean) {
      ok("Merge clean");
    } else {
      console.log(`    Conflicts in: ${mergeResult.conflicts.join(", ")}\n`);
    }

    // -------------------------------------------------------------------
    // EM Review Agent
    // -------------------------------------------------------------------
    divider();
    console.log(`  EM Review: Phase ${phaseNum}`);
    divider();
    console.log();

    markReviewStatus(progress, phaseIdx, "in_progress");
    writeProgress(progressPath, progress);

    const reviewPrompt = buildEmReviewPrompt(
      phase,
      slug,
      phaseNum,
      projectContext,
      !mergeResult.clean,
      mergeResult.conflicts
    );

    const reviewHandle = await dispatchAgent(
      agent,
      reviewPrompt,
      cwd,
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

  // Cleanup worktrees
  step("Cleaning up worktrees...");
  try {
    cleanupWorktrees(cwd);
    ok("Worktrees removed");
  } catch {
    console.log("    Could not remove worktrees automatically. Clean up manually.\n");
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
