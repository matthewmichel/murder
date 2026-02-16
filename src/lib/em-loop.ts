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
  buildEngineerPrompt,
  buildEmReviewPrompt,
  engineerNotesPath,
} from "./prompts.js";
import { ok, fail, divider, formatDuration } from "./cli-utils.js";

// ---------------------------------------------------------------------------
// Result type returned to the caller
// ---------------------------------------------------------------------------

export interface EmLoopResult {
  status: "completed" | "failed";
  totalElapsedMs: number;
  phasesCompleted: number;
  totalPhases: number;
}

// ---------------------------------------------------------------------------
// Main EM Loop — single engineer, phased execution with manager review
// ---------------------------------------------------------------------------

export interface EmLoopOptions {
  planDir: string;
  workDir: string;
  cwd: string;
  projectId: string;
  agent: AgentBackend;
  slug: string;
  projectContext: string;
  prdPath: string;
}

export async function runEmLoop(options: EmLoopOptions): Promise<EmLoopResult> {
  const { planDir, workDir, projectId, agent, slug, projectContext, prdPath } = options;
  const progressPath = join(planDir, "progress.json");

  const prdContent = readFileSync(prdPath, "utf-8");

  // -----------------------------------------------------------------------
  // Phase loop
  // -----------------------------------------------------------------------
  const loopStart = Date.now();
  let progress = readProgress(progressPath);
  progress.status = "in_progress";
  progress.startedAt = new Date().toISOString();
  writeProgress(progressPath, progress);

  let phasesCompleted = 0;
  const totalPhases = progress.phases.length;

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

      return {
        status: "failed",
        totalElapsedMs: Date.now() - loopStart,
        phasesCompleted,
        totalPhases,
      };
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

      return {
        status: "failed",
        totalElapsedMs: Date.now() - loopStart,
        phasesCompleted,
        totalPhases,
      };
    }

    console.log();
    ok(`Phase ${phaseNum} complete`);

    // Advance to next phase
    markPhaseStatus(progress, phaseIdx, "completed");
    advancePhase(progress);
    writeProgress(progressPath, progress);
    phasesCompleted++;
  }

  // -----------------------------------------------------------------------
  // All phases complete — report and return
  // -----------------------------------------------------------------------
  const totalElapsedMs = Date.now() - loopStart;

  divider();
  console.log("  All phases complete!\n");
  console.log(`  Total time: ${formatDuration(totalElapsedMs)}`);
  console.log(`  Phases completed: ${phasesCompleted}/${totalPhases}`);
  divider();
  console.log();

  return {
    status: "completed",
    totalElapsedMs,
    phasesCompleted,
    totalPhases,
  };
}
