import { existsSync } from "fs";
import sql from "./db.js";
import {
  getEnabledJobs,
  getPendingRuns,
  getActiveRunForJob,
  getStaleRuns,
  getStuckRunningRuns,
  getProjectById,
  createJobRun,
  updateJobRun,
  updateJob,
  slugForRun,
  shouldRunNow,
} from "./jobs.js";
import type { Job, PendingRunWithJob } from "./jobs.js";
import { runNewTaskProgrammatic } from "./run-new-task.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutorState {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastCheckedMinute: Map<string, string>;
  pipelineLock: boolean;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[job-executor ${ts}] ${msg}`);
}

function logError(msg: string) {
  const ts = new Date().toISOString();
  console.error(`[job-executor ${ts}] ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// Minute key — used to deduplicate runs within the same minute
// ---------------------------------------------------------------------------

function minuteKey(date?: Date): string {
  const d = date ?? new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Startup cleanup
// ---------------------------------------------------------------------------

async function cleanupOnStartup(): Promise<void> {
  // Mark stale pending runs (older than 60 minutes) as skipped
  const staleRuns = await getStaleRuns(60);
  for (const run of staleRuns) {
    await updateJobRun(run.id, {
      status: "skipped",
      error_message: "Skipped: run was pending for over 60 minutes (murder was likely not running)",
      completed_at: new Date().toISOString(),
    });
    log(`Marked stale pending run ${run.id} as skipped`);
  }

  // Mark runs stuck in 'running' status (from a previous crash) as failed
  const stuckRuns = await getStuckRunningRuns();
  for (const run of stuckRuns) {
    await updateJobRun(run.id, {
      status: "failed",
      error_message: "Failed: run was still in 'running' status when executor restarted (previous crash or shutdown)",
      completed_at: new Date().toISOString(),
    });
    log(`Marked stuck running run ${run.id} as failed`);
  }

  if (staleRuns.length > 0 || stuckRuns.length > 0) {
    log(`Startup cleanup: ${staleRuns.length} stale, ${stuckRuns.length} stuck runs cleaned up`);
  }
}

// ---------------------------------------------------------------------------
// Schedule check — create pending runs for jobs whose schedule matches now
// ---------------------------------------------------------------------------

async function checkSchedules(state: ExecutorState): Promise<void> {
  const now = new Date();
  const currentMinute = minuteKey(now);

  let jobs: Job[];
  try {
    jobs = await getEnabledJobs();
  } catch (err) {
    logError(`Failed to fetch enabled jobs: ${(err as Error).message}`);
    return;
  }

  for (const job of jobs) {
    // Skip if we already checked this job for this minute
    if (state.lastCheckedMinute.get(job.id) === currentMinute) {
      continue;
    }

    if (shouldRunNow(job.schedule, now)) {
      try {
        await createJobRun(job.id);
        log(`Created pending run for job "${job.name}" (${job.slug})`);
      } catch (err) {
        logError(`Failed to create run for job "${job.name}": ${(err as Error).message}`);
      }
    }

    state.lastCheckedMinute.set(job.id, currentMinute);
  }
}

// ---------------------------------------------------------------------------
// Execute pending runs — serialized, one at a time
// ---------------------------------------------------------------------------

async function processPendingRuns(state: ExecutorState): Promise<void> {
  if (state.pipelineLock) {
    return;
  }

  let pendingRuns: PendingRunWithJob[];
  try {
    pendingRuns = await getPendingRuns();
  } catch (err) {
    logError(`Failed to fetch pending runs: ${(err as Error).message}`);
    return;
  }

  if (pendingRuns.length === 0) return;

  for (const pendingRun of pendingRuns) {
    // Check if there's already an active run for this job
    try {
      const activeRun = await getActiveRunForJob(pendingRun.job_id);
      if (activeRun) {
        await updateJobRun(pendingRun.id, {
          status: "skipped",
          error_message: `Skipped: job "${pendingRun.job.name}" already has an active run (${activeRun.id})`,
          completed_at: new Date().toISOString(),
        });
        log(`Skipped run ${pendingRun.id} — job "${pendingRun.job.name}" already has an active run`);
        continue;
      }
    } catch (err) {
      logError(`Failed to check active run for job ${pendingRun.job_id}: ${(err as Error).message}`);
      continue;
    }

    // Serialize: only one pipeline at a time
    state.pipelineLock = true;

    try {
      await executeRun(pendingRun);
    } catch (err) {
      logError(`Unexpected error executing run ${pendingRun.id}: ${(err as Error).message}`);
    } finally {
      state.pipelineLock = false;
    }

    // Only process one run per tick to keep things serialized
    break;
  }
}

// ---------------------------------------------------------------------------
// Execute a single run
// ---------------------------------------------------------------------------

async function executeRun(pendingRun: PendingRunWithJob): Promise<void> {
  const { job } = pendingRun;

  // Mark as running
  await updateJobRun(pendingRun.id, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  // Generate run slug
  const runSlug = slugForRun(job.slug);
  await updateJobRun(pendingRun.id, { slug_used: runSlug });

  log(`Executing run ${pendingRun.id} for job "${job.name}" with slug "${runSlug}"`);

  // Validate project exists
  const project = await getProjectById(job.project_id);
  if (!project) {
    await updateJobRun(pendingRun.id, {
      status: "failed",
      error_message: `Project ${job.project_id} not found in database`,
      completed_at: new Date().toISOString(),
    });
    await updateJob(job.id, { last_run_at: new Date().toISOString() });
    logError(`Run ${pendingRun.id} failed: project ${job.project_id} not found`);
    return;
  }

  // Validate project root_path exists on disk
  if (!existsSync(project.root_path)) {
    await updateJobRun(pendingRun.id, {
      status: "failed",
      error_message: `Project root path does not exist: ${project.root_path}`,
      completed_at: new Date().toISOString(),
    });
    await updateJob(job.id, { last_run_at: new Date().toISOString() });
    logError(`Run ${pendingRun.id} failed: project root path does not exist: ${project.root_path}`);
    return;
  }

  // Run the murder new pipeline
  try {
    const result = await runNewTaskProgrammatic({
      prompt: job.prompt,
      projectId: job.project_id,
      projectRootPath: project.root_path,
      slug: runSlug,
    });

    if (result.status === "completed") {
      await updateJobRun(pendingRun.id, {
        status: "completed",
        branch_name: result.branchName ?? undefined,
        pr_url: result.prUrl ?? undefined,
        completed_at: new Date().toISOString(),
      });
      log(`Run ${pendingRun.id} completed successfully. Branch: ${result.branchName}, PR: ${result.prUrl ?? "none"}`);
    } else {
      await updateJobRun(pendingRun.id, {
        status: "failed",
        branch_name: result.branchName ?? undefined,
        error_message: result.error ?? "Pipeline returned failed status",
        completed_at: new Date().toISOString(),
      });
      log(`Run ${pendingRun.id} failed: ${result.error ?? "unknown error"}`);
    }
  } catch (err) {
    await updateJobRun(pendingRun.id, {
      status: "failed",
      error_message: `Unexpected error: ${(err as Error).message}`,
      completed_at: new Date().toISOString(),
    });
    logError(`Run ${pendingRun.id} failed with unexpected error: ${(err as Error).message}`);
  }

  // Update job's last_run_at regardless of outcome
  try {
    await updateJob(job.id, { last_run_at: new Date().toISOString() });
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

async function tick(state: ExecutorState): Promise<void> {
  try {
    await checkSchedules(state);
    await processPendingRuns(state);
  } catch (err) {
    logError(`Tick error: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;

/**
 * Start the job executor polling loop.
 * Returns a cleanup function that stops the loop and closes the DB connection.
 */
export async function startJobExecutor(): Promise<() => void> {
  log("Starting job executor...");

  // Verify database connection
  try {
    await sql`SELECT 1`;
  } catch (err) {
    logError(`Cannot connect to database: ${(err as Error).message}`);
    throw err;
  }

  // Cleanup stale/stuck runs from previous sessions
  await cleanupOnStartup();

  const state: ExecutorState = {
    timer: null,
    running: true,
    lastCheckedMinute: new Map(),
    pipelineLock: false,
  };

  // Run first tick immediately
  await tick(state);

  // Start polling loop
  state.timer = setInterval(async () => {
    if (!state.running) return;
    await tick(state);
  }, POLL_INTERVAL_MS);

  log(`Polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Return cleanup function
  return () => {
    state.running = false;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    log("Job executor stopped");
  };
}
