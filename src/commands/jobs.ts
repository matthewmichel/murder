import sql from "../lib/db.js";
import { listJobs, listJobRuns } from "../lib/jobs.js";
import type { Job, JobRun } from "../lib/jobs.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);

  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "running":
      return "⠹";
    case "pending":
      return "○";
    case "skipped":
      return "⊘";
    default:
      return "?";
  }
}

function enabledBadge(enabled: boolean): string {
  return enabled ? "enabled" : "disabled";
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function jobs() {
  console.log();

  let allJobs: Job[];
  try {
    allJobs = await listJobs();
  } catch {
    console.log("  ✗ Could not connect to the database.");
    console.log("    Make sure murder is running (murder start).\n");
    process.exit(1);
    return;
  }

  if (allJobs.length === 0) {
    console.log("  No jobs configured.\n");
    console.log("  Create jobs from the web UI at http://localhost:1314/jobs\n");
    await sql.end();
    return;
  }

  console.log(`  ${allJobs.length} job(s):\n`);

  for (const job of allJobs) {
    const badge = enabledBadge(job.is_enabled);
    const lastRun = relativeTime(job.last_run_at);
    const icon = job.is_enabled ? "●" : "○";

    console.log(`  ${icon} ${job.name} [${badge}]`);
    console.log(`    Schedule: ${job.schedule}`);
    console.log(`    Last run: ${lastRun}`);
    console.log(`    Slug:     ${job.slug}`);

    // Show last 3 runs
    try {
      const runs: JobRun[] = await listJobRuns(job.id, 3);
      if (runs.length > 0) {
        console.log(`    Recent runs:`);
        for (const run of runs) {
          const runIcon = statusIcon(run.status);
          const when = relativeTime(run.completed_at ?? run.started_at ?? run.created_at);
          const slug = run.slug_used ? ` (${run.slug_used})` : "";
          const pr = run.pr_url ? ` → ${run.pr_url}` : "";
          const err = run.error_message ? ` — ${run.error_message.slice(0, 80)}` : "";
          console.log(`      ${runIcon} ${run.status}${slug} ${when}${pr}${err}`);
        }
      }
    } catch {
      // non-critical — skip run display
    }

    console.log();
  }

  await sql.end();
}
