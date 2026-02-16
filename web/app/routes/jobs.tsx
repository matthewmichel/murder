import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import sql from "../lib/db.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
}

interface JobRunRow {
  id: string;
  job_id: string;
  status: string;
  slug_used: string | null;
  branch_name: string | null;
  pr_url: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface JobRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  prompt: string;
  schedule: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  project_name: string;
  latest_run_status: string | null;
  last_run_at: string | null;
  runs: JobRunRow[];
}

// ---------------------------------------------------------------------------
// CRON helpers
// ---------------------------------------------------------------------------

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid CRON expression";

  const [minute, hour, dom, month, dow] = parts;

  const dowNames: Record<string, string> = {
    "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
    "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday",
  };

  const formatTime = (h: string, m: string) => {
    const hr = parseInt(h, 10);
    const mn = parseInt(m, 10);
    const ampm = hr >= 12 ? "PM" : "AM";
    const displayHr = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${displayHr}:${String(mn).padStart(2, "0")} ${ampm}`;
  };

  // Every N minutes
  if (minute.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const step = minute.slice(2);
    return `Every ${step} minutes`;
  }

  // Every N hours
  if (minute !== "*" && hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    const step = hour.slice(2);
    return `Every ${step} hours at minute ${minute}`;
  }

  // Specific minute + hour patterns
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const time = formatTime(hour, minute);

    // Daily
    if (dom === "*" && month === "*" && dow === "*") {
      return `Every day at ${time}`;
    }

    // Specific day of week
    if (dom === "*" && month === "*" && /^\d$/.test(dow)) {
      const dayName = dowNames[dow] ?? `day ${dow}`;
      return `Every ${dayName} at ${time}`;
    }

    // Specific day of month
    if (/^\d+$/.test(dom) && month === "*" && dow === "*") {
      const d = parseInt(dom, 10);
      const suffix = d === 1 || d === 21 || d === 31 ? "st" : d === 2 || d === 22 ? "nd" : d === 3 || d === 23 ? "rd" : "th";
      return `Monthly on the ${d}${suffix} at ${time}`;
    }
  }

  // Fallback: just show the expression
  return `Cron: ${expr}`;
}

function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    { min: 0, max: 59 },  // minute
    { min: 0, max: 23 },  // hour
    { min: 1, max: 31 },  // day of month
    { min: 1, max: 12 },  // month
    { min: 0, max: 7 },   // day of week
  ];

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    if (field === "*") continue;
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step <= 0) return false;
      continue;
    }
    // Comma-separated
    const segments = field.split(",");
    for (const seg of segments) {
      if (seg.includes("-")) {
        const [a, b] = seg.split("-").map(Number);
        if (isNaN(a) || isNaN(b) || a < ranges[i].min || b > ranges[i].max || a > b) return false;
      } else {
        const n = parseInt(seg, 10);
        if (isNaN(n) || n < ranges[i].min || n > ranges[i].max) return false;
      }
    }
  }
  return true;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader() {
  const [jobRows, projects] = await Promise.all([
    sql`
      SELECT
        j.id, j.project_id, j.name, j.slug, j.prompt, j.schedule,
        j.is_enabled, j.created_at, j.updated_at, j.last_run_at,
        p.name AS project_name,
        lr.status AS latest_run_status
      FROM jobs j
      JOIN projects p ON p.id = j.project_id
      LEFT JOIN LATERAL (
        SELECT jr.status
        FROM job_runs jr
        WHERE jr.job_id = j.id
        ORDER BY jr.created_at DESC
        LIMIT 1
      ) lr ON true
      ORDER BY j.created_at DESC
    `,
    sql`SELECT id, name FROM projects ORDER BY name ASC`,
  ]);

  const jobs = jobRows as unknown as JobRow[];

  // Fetch last 10 runs per job
  if (jobs.length > 0) {
    const jobIds = jobs.map((j) => j.id);
    const runRows = await sql`
      SELECT
        jr.id, jr.job_id, jr.status, jr.slug_used, jr.branch_name,
        jr.pr_url, jr.error_message, jr.started_at, jr.completed_at,
        jr.created_at
      FROM (
        SELECT
          jr2.*,
          ROW_NUMBER() OVER (PARTITION BY jr2.job_id ORDER BY jr2.created_at DESC) AS rn
        FROM job_runs jr2
        WHERE jr2.job_id = ANY(${jobIds}::uuid[])
      ) jr
      WHERE jr.rn <= 10
      ORDER BY jr.job_id, jr.created_at DESC
    `;

    const runs = runRows as unknown as JobRunRow[];
    const runsByJobId = new Map<string, JobRunRow[]>();
    for (const run of runs) {
      const list = runsByJobId.get(run.job_id) ?? [];
      list.push(run);
      runsByJobId.set(run.job_id, list);
    }

    for (const job of jobs) {
      job.runs = runsByJobId.get(job.id) ?? [];
    }
  } else {
    // no jobs, nothing to do
  }

  // Ensure runs array exists
  for (const job of jobs) {
    if (!job.runs) job.runs = [];
  }

  return { jobs, projects: projects as unknown as Project[] };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "create") {
    const name = (form.get("name") as string)?.trim();
    const projectId = (form.get("project_id") as string)?.trim();
    const prompt = (form.get("prompt") as string)?.trim();
    const schedule = (form.get("schedule") as string)?.trim();

    if (!name) return { error: "Name is required." };
    if (!projectId) return { error: "Project is required." };
    if (!prompt) return { error: "Prompt is required." };
    if (!schedule) return { error: "Schedule is required." };
    if (!isValidCron(schedule)) return { error: "Invalid CRON expression. Use 5-field format: minute hour day-of-month month day-of-week" };

    const slug = slugify(name);
    if (!slug) return { error: "Name must contain at least one alphanumeric character." };

    const existing = await sql`SELECT id FROM jobs WHERE slug = ${slug}`;
    if (existing.length > 0) {
      return { error: `A job with slug "${slug}" already exists. Choose a different name.` };
    }

    await sql`
      INSERT INTO jobs (project_id, name, slug, prompt, schedule)
      VALUES (${projectId}::uuid, ${name}, ${slug}, ${prompt}, ${schedule})
    `;
    return { success: `Job "${name}" created.` };
  }

  if (intent === "update") {
    const jobId = form.get("jobId") as string;
    const name = (form.get("name") as string)?.trim();
    const prompt = (form.get("prompt") as string)?.trim();
    const schedule = (form.get("schedule") as string)?.trim();

    if (!jobId) return { error: "Job ID is required." };
    if (!name) return { error: "Name is required." };
    if (!prompt) return { error: "Prompt is required." };
    if (!schedule) return { error: "Schedule is required." };
    if (!isValidCron(schedule)) return { error: "Invalid CRON expression." };

    await sql`
      UPDATE jobs
      SET name = ${name}, prompt = ${prompt}, schedule = ${schedule}
      WHERE id = ${jobId}::uuid
    `;
    return { success: `Job "${name}" updated.` };
  }

  if (intent === "toggle") {
    const jobId = form.get("jobId") as string;
    const isEnabled = form.get("is_enabled") === "true";
    if (!jobId) return { error: "Job ID is required." };

    await sql`
      UPDATE jobs SET is_enabled = ${isEnabled}
      WHERE id = ${jobId}::uuid
    `;
    return { success: `Job ${isEnabled ? "enabled" : "disabled"}.` };
  }

  if (intent === "delete") {
    const jobId = form.get("jobId") as string;
    if (!jobId) return { error: "Job ID is required." };

    await sql`DELETE FROM jobs WHERE id = ${jobId}::uuid`;
    return { success: "Job deleted." };
  }

  return { error: "Unknown action." };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Jobs() {
  const { jobs, projects } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cronPreview, setCronPreview] = useState("");
  const [scheduleInput, setScheduleInput] = useState("");

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Jobs</h2>

      {actionData && "error" in actionData && (
        <div className="alert alert-error mb-4">
          <span>{actionData.error}</span>
        </div>
      )}
      {actionData && "success" in actionData && (
        <div className="alert alert-success mb-4">
          <span>{actionData.success}</span>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-3 mb-6">
          {jobs.map((job) => (
            <div key={job.id} className="card bg-base-200">
              <div className="card-body p-4">
                {editingId === job.id ? (
                  <EditJobForm
                    job={job}
                    isSubmitting={isSubmitting}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{job.name}</h3>
                          <span className="badge badge-ghost badge-sm">{job.project_name}</span>
                          {job.is_enabled ? (
                            <span className="badge badge-success badge-sm">enabled</span>
                          ) : (
                            <span className="badge badge-neutral badge-sm">disabled</span>
                          )}
                          <RunStatusBadge status={job.latest_run_status} />
                        </div>
                        <p className="text-sm text-base-content/60 mt-1">
                          {describeCron(job.schedule)}
                        </p>
                        <p className="text-xs text-base-content/40 mt-0.5 font-mono">
                          {job.schedule}
                        </p>
                        <div className="flex gap-3 mt-2 text-xs text-base-content/50">
                          <span>
                            Last run:{" "}
                            {job.last_run_at
                              ? new Date(job.last_run_at).toLocaleString()
                              : "never"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="toggle" />
                          <input type="hidden" name="jobId" value={job.id} />
                          <input
                            type="hidden"
                            name="is_enabled"
                            value={job.is_enabled ? "false" : "true"}
                          />
                          <input
                            type="checkbox"
                            className="toggle toggle-success toggle-sm"
                            checked={job.is_enabled}
                            onChange={(e) => {
                              e.target.closest("form")?.requestSubmit();
                            }}
                          />
                        </Form>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => setEditingId(job.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            setExpandedId(expandedId === job.id ? null : job.id)
                          }
                        >
                          {expandedId === job.id ? "Hide" : "History"}
                        </button>
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="jobId" value={job.id} />
                          <button
                            type="submit"
                            className="btn btn-ghost btn-xs text-error"
                            disabled={isSubmitting}
                            onClick={(e) => {
                              if (
                                !confirm(
                                  `Delete job "${job.name}"? This will remove all run history.`
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            Delete
                          </button>
                        </Form>
                      </div>
                    </div>

                    <p className="text-sm text-base-content/70 mt-2 line-clamp-2">
                      {job.prompt}
                    </p>

                    {expandedId === job.id && (
                      <RunHistory runs={job.runs} />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Job Form */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-base">New Job</h3>
          {projects.length === 0 ? (
            <div className="alert alert-warning">
              <span>
                No projects found. Create a project on the{" "}
                <a href="/projects" className="link">Projects</a> page first.
              </span>
            </div>
          ) : (
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Name</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    placeholder="Nightly Deduplication"
                    className="input input-bordered input-sm"
                    required
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Project</span>
                  </label>
                  <select
                    name="project_id"
                    className="select select-bordered select-sm"
                    required
                  >
                    <option value="" disabled selected>
                      Select a project…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-control md:col-span-2">
                  <label className="label">
                    <span className="label-text">Prompt</span>
                  </label>
                  <textarea
                    name="prompt"
                    placeholder="Scan the codebase for code duplication and submit a PR to eliminate it..."
                    className="textarea textarea-bordered textarea-sm min-h-20"
                    required
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Schedule (CRON)</span>
                  </label>
                  <input
                    type="text"
                    name="schedule"
                    placeholder="0 2 * * *"
                    className="input input-bordered input-sm font-mono"
                    required
                    value={scheduleInput}
                    onChange={(e) => {
                      setScheduleInput(e.target.value);
                      const val = e.target.value.trim();
                      if (val && isValidCron(val)) {
                        setCronPreview(describeCron(val));
                      } else if (val) {
                        setCronPreview("Invalid CRON expression");
                      } else {
                        setCronPreview("");
                      }
                    }}
                  />
                  {cronPreview && (
                    <p className={`text-xs mt-1 ${cronPreview === "Invalid CRON expression" ? "text-error" : "text-success"}`}>
                      {cronPreview}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setScheduleInput("0 2 * * *");
                        setCronPreview(describeCron("0 2 * * *"));
                      }}
                    >
                      Daily at 2 AM
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setScheduleInput("0 9 * * 1");
                        setCronPreview(describeCron("0 9 * * 1"));
                      }}
                    >
                      Weekly Monday 9 AM
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setScheduleInput("0 */6 * * *");
                        setCronPreview(describeCron("0 */6 * * *"));
                      }}
                    >
                      Every 6 hours
                    </button>
                  </div>
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={isSubmitting}
              >
                Create Job
              </button>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RunStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="badge badge-ghost badge-sm">never run</span>;
  }
  const styles: Record<string, string> = {
    completed: "badge-success",
    failed: "badge-error",
    running: "badge-info",
    pending: "badge-warning",
    skipped: "badge-neutral",
  };
  return (
    <span className={`badge badge-sm ${styles[status] ?? "badge-ghost"}`}>
      {status}
    </span>
  );
}

function EditJobForm({
  job,
  isSubmitting,
  onCancel,
}: {
  job: JobRow;
  isSubmitting: boolean;
  onCancel: () => void;
}) {
  const [schedule, setSchedule] = useState(job.schedule);
  const [preview, setPreview] = useState(describeCron(job.schedule));

  return (
    <Form
      method="post"
      onSubmit={() => onCancel()}
      className="space-y-3"
    >
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="jobId" value={job.id} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="form-control">
          <label className="label">
            <span className="label-text text-xs">Name</span>
          </label>
          <input
            type="text"
            name="name"
            defaultValue={job.name}
            className="input input-bordered input-sm"
            required
          />
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text text-xs">Schedule (CRON)</span>
          </label>
          <input
            type="text"
            name="schedule"
            value={schedule}
            onChange={(e) => {
              setSchedule(e.target.value);
              const val = e.target.value.trim();
              if (val && isValidCron(val)) {
                setPreview(describeCron(val));
              } else if (val) {
                setPreview("Invalid CRON expression");
              } else {
                setPreview("");
              }
            }}
            className="input input-bordered input-sm font-mono"
            required
          />
          {preview && (
            <p className={`text-xs mt-1 ${preview === "Invalid CRON expression" ? "text-error" : "text-success"}`}>
              {preview}
            </p>
          )}
        </div>
        <div className="form-control md:col-span-2">
          <label className="label">
            <span className="label-text text-xs">Prompt</span>
          </label>
          <textarea
            name="prompt"
            defaultValue={job.prompt}
            className="textarea textarea-bordered textarea-sm min-h-20"
            required
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={isSubmitting}
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </Form>
  );
}

function RunHistory({ runs }: { runs: JobRunRow[] }) {
  if (runs.length === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-base-content/10">
        <p className="text-sm text-base-content/50">No runs yet.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-base-content/10">
      <h4 className="text-sm font-medium mb-2">Recent Runs</h4>
      <div className="overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Status</th>
              <th>Time</th>
              <th>Branch</th>
              <th>PR</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="text-xs text-base-content/60">
                  {run.started_at
                    ? new Date(run.started_at).toLocaleString()
                    : run.created_at
                    ? new Date(run.created_at).toLocaleString()
                    : "—"}
                </td>
                <td className="text-xs font-mono text-base-content/60">
                  {run.branch_name ?? "—"}
                </td>
                <td>
                  {run.pr_url ? (
                    <a
                      href={run.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary text-xs"
                    >
                      View PR
                    </a>
                  ) : (
                    <span className="text-xs text-base-content/40">—</span>
                  )}
                </td>
                <td>
                  {run.error_message ? (
                    <span className="text-xs text-error truncate max-w-48 inline-block" title={run.error_message}>
                      {run.error_message}
                    </span>
                  ) : (
                    <span className="text-xs text-base-content/40">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
