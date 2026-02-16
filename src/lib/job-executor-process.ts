/**
 * Standalone entry point for the job executor.
 * Spawned as a detached background process by `murder start`.
 * Runs the polling loop and keeps the process alive.
 */
import { startJobExecutor } from "./job-executor.js";

let cleanup: (() => void) | null = null;

async function main() {
  try {
    cleanup = await startJobExecutor();
  } catch (err) {
    console.error(`[job-executor-process] Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  if (cleanup) cleanup();
  process.exit(0);
});

process.on("SIGINT", () => {
  if (cleanup) cleanup();
  process.exit(0);
});

main();
