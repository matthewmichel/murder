import { statSync, readFileSync } from "fs";
import type { TaskHandle } from "./dispatch.js";
import type { OutputFormat } from "./dispatch.js";
import {
  updateTaskOutput,
  completeTask,
  markTaskKilled,
} from "./dispatch.js";
import { matchStuckPattern, type StuckAction } from "./patterns.js";
import { diagnoseOutput } from "./diagnosis.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitorOptions {
  outputTimeoutMs?: number;
  maxRetries?: number;
  checkIntervalMs?: number;
  projectId?: string;
  /** Matches the dispatch output format — determines monitoring behavior */
  outputFormat?: OutputFormat;
}

export interface TaskResult {
  status: "completed" | "failed" | "killed" | "stuck";
  exitCode: number | null;
  diagnosis: string | null;
  elapsedMs: number;
  outputBytes: number;
}

// ---------------------------------------------------------------------------
// Spinner rendering
// ---------------------------------------------------------------------------

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function writeSpinner(
  frame: number,
  agentName: string,
  elapsedMs: number,
  outputBytes: number
) {
  const icon = SPINNER[frame % SPINNER.length];
  const elapsed = formatDuration(elapsedMs);
  const size = formatBytes(outputBytes);
  process.stdout.write(
    `\r  ${icon} ${agentName} is working... (${elapsed}, ${size} output)  `
  );
}

function clearSpinnerLine() {
  process.stdout.write("\r\x1B[2K");
}

// ---------------------------------------------------------------------------
// Process utilities
// ---------------------------------------------------------------------------

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

function getFileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readLastLines(path: string, maxLines: number = 50): string {
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

async function handleStuckAction(
  action: StuckAction,
  diagnosis: string,
  handle: TaskHandle,
  outputBytes: number,
  _options: MonitorOptions
): Promise<TaskResult> {
  const elapsed = Date.now() - handle.startedAt;
  const isPiped = (_options.outputFormat ?? "pipe") === "pipe";

  function clearLine() {
    if (isPiped) clearSpinnerLine();
  }

  switch (action) {
    case "kill": {
      clearLine();
      console.log(`  ✗ ${handle.agentName} — ${diagnosis}`);
      killProcess(handle.pid);
      await markTaskKilled(handle.taskId, diagnosis);
      return {
        status: "killed",
        exitCode: null,
        diagnosis,
        elapsedMs: elapsed,
        outputBytes,
      };
    }

    case "retry": {
      clearLine();
      console.log(`  ⚠ ${handle.agentName} — ${diagnosis}`);
      console.log("    Will retry...");
      killProcess(handle.pid);
      await markTaskKilled(handle.taskId, diagnosis);
      return {
        status: "killed",
        exitCode: null,
        diagnosis: `${diagnosis} (retry suggested)`,
        elapsedMs: elapsed,
        outputBytes,
      };
    }

    case "escalate": {
      clearLine();
      console.log(`  ⚠ ${handle.agentName} may be stuck`);
      console.log(`    Diagnosis: ${diagnosis}`);
      console.log(`    Log: ${handle.logPath}`);
      console.log(`    PID: ${handle.pid}`);
      console.log(`    The agent is still running. Kill with: kill ${handle.pid}`);
      return {
        status: "stuck",
        exitCode: null,
        diagnosis,
        elapsedMs: elapsed,
        outputBytes,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Main monitor loop
// ---------------------------------------------------------------------------

/**
 * Monitor a dispatched agent task.
 *
 * Behavior depends on outputFormat:
 * - "pipe":        Spinner + log-file-based stuck detection (default)
 * - "stream-json": Progress is displayed by dispatch; monitor uses log file
 *                  for stuck detection (JSON events are written to log)
 * - "inherit":     Agent has full TTY; monitor only checks process liveness
 */
export async function monitorTask(
  handle: TaskHandle,
  options: MonitorOptions = {}
): Promise<TaskResult> {
  const {
    outputTimeoutMs = 30_000,
    checkIntervalMs = 5_000,
    projectId,
    outputFormat = "pipe",
  } = options;

  const showSpinner = outputFormat === "pipe";

  // "inherit" mode: agent has full TTY, no log file to watch.
  // Just poll process liveness.
  if (outputFormat === "inherit") {
    while (true) {
      await sleep(checkIntervalMs);
      if (!isProcessAlive(handle.pid)) {
        const { exitCode } = await handle.done;
        const status = exitCode === 0 ? "completed" : "failed";
        const elapsedMs = Date.now() - handle.startedAt;
        const duration = formatDuration(elapsedMs);

        console.log();
        if (status === "completed") {
          console.log(`  ✓ ${handle.agentName} finished (${duration})`);
        } else {
          console.log(
            `  ✗ ${handle.agentName} exited with code ${exitCode} (${duration})`
          );
        }

        try {
          await completeTask(handle.taskId, exitCode, status);
        } catch {
          // DB update failed, non-critical
        }

        return { status, exitCode, diagnosis: null, elapsedMs, outputBytes: 0 };
      }
    }
  }

  // --- "pipe" and "stream-json" paths: log-file-based monitoring ---

  let lastOutputBytes = 0;
  let lastOutputTime = Date.now();
  let spinnerFrame = 0;
  let aiCheckDone = false;

  while (true) {
    await sleep(checkIntervalMs);

    const now = Date.now();
    const elapsedMs = now - handle.startedAt;
    const currentBytes = getFileSize(handle.logPath);

    // New output detected — reset the no-output timer
    if (currentBytes > lastOutputBytes) {
      lastOutputBytes = currentBytes;
      lastOutputTime = now;
      aiCheckDone = false;

      try {
        await updateTaskOutput(handle.taskId, currentBytes);
      } catch {
        // DB update failed, non-critical
      }
    }

    // Check if the process has exited
    if (!isProcessAlive(handle.pid)) {
      if (showSpinner) clearSpinnerLine();
      const { exitCode } = await handle.done;
      const status = exitCode === 0 ? "completed" : "failed";
      const duration = formatDuration(elapsedMs);

      if (status === "completed") {
        console.log(`\n  ✓ ${handle.agentName} finished (${duration})`);
      } else {
        console.log(
          `\n  ✗ ${handle.agentName} exited with code ${exitCode} (${duration})`
        );
      }

      try {
        await completeTask(handle.taskId, exitCode, status);
      } catch {
        // DB update failed, non-critical
      }

      return {
        status,
        exitCode,
        diagnosis: null,
        elapsedMs,
        outputBytes: currentBytes,
      };
    }

    // Show spinner only in pipe mode (stream-json displays its own progress)
    if (showSpinner) {
      writeSpinner(spinnerFrame++, handle.agentName, elapsedMs, currentBytes);
    }

    // Check for output timeout (potential stuck agent)
    const silenceMs = now - lastOutputTime;
    if (silenceMs < outputTimeoutMs) continue;

    // Agent has been silent too long — investigate
    const recentOutput = readLastLines(handle.logPath, 50);

    // Phase 1: Pattern matching (cheap)
    const patternResult = matchStuckPattern(handle.agentSlug, recentOutput);
    if (patternResult.matched) {
      return handleStuckAction(
        patternResult.action,
        patternResult.diagnosis,
        handle,
        currentBytes,
        options
      );
    }

    // Phase 2: AI diagnosis (expensive, run once per silence window)
    if (!aiCheckDone) {
      aiCheckDone = true;

      try {
        const aiResult = await diagnoseOutput(
          handle.agentName,
          recentOutput,
          elapsedMs,
          silenceMs,
          projectId
        );

        if (aiResult.verdict !== "continue") {
          return handleStuckAction(
            aiResult.verdict,
            aiResult.diagnosis,
            handle,
            currentBytes,
            options
          );
        }

        // AI says continue — extend the timeout window and keep monitoring
        lastOutputTime = now;
      } catch {
        // AI diagnosis failed (no orchestration model configured, etc.)
        // Fall back to conservative heuristic: escalate after 60s total silence
        if (silenceMs > 60_000) {
          return handleStuckAction(
            "escalate",
            `No output for ${formatDuration(silenceMs)} and AI diagnosis unavailable. The agent may be stuck.`,
            handle,
            currentBytes,
            options
          );
        }
      }
    }

    // If AI already checked and said continue, but silence persists beyond 2x timeout, escalate
    if (silenceMs > outputTimeoutMs * 2) {
      return handleStuckAction(
        "escalate",
        `No output for ${formatDuration(silenceMs)}. The agent may be stuck.`,
        handle,
        currentBytes,
        options
      );
    }
  }
}
