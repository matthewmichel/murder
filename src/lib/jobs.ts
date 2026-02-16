import { randomBytes } from "crypto";
import sql from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  prompt: string;
  schedule: string;
  is_enabled: boolean;
  last_run_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface JobRun {
  id: string;
  job_id: string;
  task_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  slug_used: string | null;
  branch_name: string | null;
  pr_url: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobWithRun extends Job {
  latest_run_status: string | null;
  latest_run_at: string | null;
}

export interface PendingRunWithJob extends JobRun {
  job: Job;
}

// ---------------------------------------------------------------------------
// Job CRUD
// ---------------------------------------------------------------------------

export async function listJobs(): Promise<Job[]> {
  const rows = await sql`
    SELECT * FROM jobs ORDER BY created_at DESC
  `;
  return rows as unknown as Job[];
}

export async function getJob(id: string): Promise<Job | null> {
  const rows = await sql`
    SELECT * FROM jobs WHERE id = ${id}::uuid LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as Job;
}

export interface CreateJobData {
  project_id: string;
  name: string;
  slug: string;
  prompt: string;
  schedule: string;
  is_enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export async function createJob(data: CreateJobData): Promise<Job> {
  const rows = await sql`
    INSERT INTO jobs (project_id, name, slug, prompt, schedule, is_enabled, metadata)
    VALUES (
      ${data.project_id}::uuid,
      ${data.name},
      ${data.slug},
      ${data.prompt},
      ${data.schedule},
      ${data.is_enabled ?? true},
      ${JSON.stringify(data.metadata ?? {})}::jsonb
    )
    RETURNING *
  `;
  return rows[0] as unknown as Job;
}

export interface UpdateJobData {
  name?: string;
  prompt?: string;
  schedule?: string;
  is_enabled?: boolean;
  last_run_at?: string;
  metadata?: Record<string, unknown>;
}

export async function updateJob(id: string, data: UpdateJobData): Promise<Job | null> {
  const rows = await sql`
    UPDATE jobs SET
      name = COALESCE(${data.name ?? null}, name),
      prompt = COALESCE(${data.prompt ?? null}, prompt),
      schedule = COALESCE(${data.schedule ?? null}, schedule),
      is_enabled = COALESCE(${data.is_enabled ?? null}, is_enabled),
      last_run_at = COALESCE(${data.last_run_at ?? null}::timestamptz, last_run_at),
      metadata = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb, metadata)
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as Job;
}

export async function deleteJob(id: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM jobs WHERE id = ${id}::uuid RETURNING id
  `;
  return rows.length > 0;
}

export async function toggleJob(id: string, isEnabled: boolean): Promise<Job | null> {
  const rows = await sql`
    UPDATE jobs SET is_enabled = ${isEnabled}
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as Job;
}

// ---------------------------------------------------------------------------
// Job Runs
// ---------------------------------------------------------------------------

export async function listJobRuns(jobId: string, limit: number = 20): Promise<JobRun[]> {
  const rows = await sql`
    SELECT * FROM job_runs
    WHERE job_id = ${jobId}::uuid
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as JobRun[];
}

export async function createJobRun(jobId: string): Promise<JobRun> {
  const rows = await sql`
    INSERT INTO job_runs (job_id, status)
    VALUES (${jobId}::uuid, 'pending')
    RETURNING *
  `;
  return rows[0] as unknown as JobRun;
}

export interface UpdateJobRunData {
  status?: "pending" | "running" | "completed" | "failed" | "skipped";
  task_id?: string;
  slug_used?: string;
  branch_name?: string;
  pr_url?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
}

export async function updateJobRun(id: string, data: UpdateJobRunData): Promise<JobRun | null> {
  const rows = await sql`
    UPDATE job_runs SET
      status = COALESCE(${data.status ?? null}, status),
      task_id = COALESCE(${data.task_id ?? null}::uuid, task_id),
      slug_used = COALESCE(${data.slug_used ?? null}, slug_used),
      branch_name = COALESCE(${data.branch_name ?? null}, branch_name),
      pr_url = COALESCE(${data.pr_url ?? null}, pr_url),
      error_message = COALESCE(${data.error_message ?? null}, error_message),
      started_at = COALESCE(${data.started_at ?? null}::timestamptz, started_at),
      completed_at = COALESCE(${data.completed_at ?? null}::timestamptz, completed_at)
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as JobRun;
}

export async function getActiveRunForJob(jobId: string): Promise<JobRun | null> {
  const rows = await sql`
    SELECT * FROM job_runs
    WHERE job_id = ${jobId}::uuid AND status = 'running'
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as JobRun;
}

export async function getPendingRuns(): Promise<PendingRunWithJob[]> {
  const rows = await sql`
    SELECT
      jr.*,
      row_to_json(j.*) AS job
    FROM job_runs jr
    JOIN jobs j ON j.id = jr.job_id
    WHERE jr.status = 'pending'
    ORDER BY jr.created_at ASC
  `;
  return rows as unknown as PendingRunWithJob[];
}

export async function getStaleRuns(maxAgeMinutes: number): Promise<JobRun[]> {
  const rows = await sql`
    SELECT * FROM job_runs
    WHERE status = 'pending'
      AND created_at < NOW() - (${maxAgeMinutes} || ' minutes')::interval
    ORDER BY created_at ASC
  `;
  return rows as unknown as JobRun[];
}

// ---------------------------------------------------------------------------
// Slug generation for job runs
// ---------------------------------------------------------------------------

export function slugForRun(jobSlug: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hex = randomBytes(2).toString("hex");
  return `${jobSlug}-${yyyy}-${mm}-${dd}-${hex}`;
}

// ---------------------------------------------------------------------------
// CRON expression matching
// ---------------------------------------------------------------------------

/**
 * Parse a single CRON field and check if a given value matches.
 * Supports: `*`, specific numbers, and `* /N` step syntax.
 */
function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;

  // Step syntax: */N
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }

  // Comma-separated values: 1,5,10
  if (field.includes(",")) {
    const parts = field.split(",");
    return parts.some((p) => cronFieldMatches(p.trim(), value, min, max));
  }

  // Range: 1-5
  if (field.includes("-")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // Specific value
  const num = parseInt(field, 10);
  if (isNaN(num)) return false;
  return value === num;
}

/**
 * Check if a CRON expression (5-field: minute, hour, day-of-month, month, day-of-week)
 * matches the current time. Returns true if the current minute matches.
 *
 * Supports:
 * - `*` (any value)
 * - Specific values (e.g. `5`)
 * - Step syntax (e.g. `* /10` for every 10)
 * - Comma-separated values (e.g. `1,15,30`)
 * - Ranges (e.g. `1-5`)
 *
 * Day-of-week: 0 = Sunday, 6 = Saturday (standard CRON)
 */
export function shouldRunNow(cronExpression: string, now?: Date): boolean {
  const d = now ?? new Date();
  const fields = cronExpression.trim().split(/\s+/);

  if (fields.length !== 5) return false;

  const [minuteField, hourField, domField, monthField, dowField] = fields;

  const minute = d.getMinutes();
  const hour = d.getHours();
  const dayOfMonth = d.getDate();
  const month = d.getMonth() + 1; // JS months are 0-indexed, CRON is 1-indexed
  const dayOfWeek = d.getDay(); // 0 = Sunday

  return (
    cronFieldMatches(minuteField, minute, 0, 59) &&
    cronFieldMatches(hourField, hour, 0, 23) &&
    cronFieldMatches(domField, dayOfMonth, 1, 31) &&
    cronFieldMatches(monthField, month, 1, 12) &&
    cronFieldMatches(dowField, dayOfWeek, 0, 6)
  );
}
