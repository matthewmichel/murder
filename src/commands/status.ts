import sql from "../lib/db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  project_name: string | null;
  root_path: string | null;
  agent_slug: string;
  command_name: string;
  status: string;
  output_bytes: number;
  ai_diagnosis: string | null;
  started_at: string;
  completed_at: string | null;
  last_output_at: string | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
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

function duration(startStr: string, endStr: string | null): string {
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);

  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusIcon(status: string): string {
  switch (status) {
    case "running":
      return "⠹";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "stuck":
      return "⚠";
    case "killed":
      return "✗";
    default:
      return "?";
  }
}

const AGENT_NAMES: Record<string, string> = {
  "cursor-cli": "Cursor CLI",
};

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function status() {
  console.log();

  let rows: TaskRow[];
  try {
    const result = await sql`
      SELECT
        t.id,
        p.name AS project_name,
        p.root_path,
        t.agent_slug,
        t.command_name,
        t.status,
        t.output_bytes,
        t.ai_diagnosis,
        t.started_at,
        t.completed_at,
        t.last_output_at
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      ORDER BY t.started_at DESC
      LIMIT 20
    `;
    rows = result as unknown as TaskRow[];
  } catch {
    console.log("  ✗ Could not connect to the database.");
    console.log("    Make sure murder is running (murder start).\n");
    process.exit(1);
    return;
  }

  if (rows.length === 0) {
    console.log("  No tasks found.\n");
    console.log("  Run 'murder init' to dispatch your first agent task.\n");
    await sql.end();
    return;
  }

  const active = rows.filter((r) => r.status === "running");
  const recent = rows.filter((r) => r.status !== "running");

  // Active tasks
  if (active.length > 0) {
    console.log("  Active tasks:\n");
    for (const task of active) {
      const agentName = AGENT_NAMES[task.agent_slug] ?? task.agent_slug;
      const dur = duration(task.started_at, null);
      const output = formatBytes(task.output_bytes);
      console.log(
        `    ${statusIcon(task.status)} ${task.command_name} (${agentName}) — ${dur}, ${output} output`
      );
      if (task.root_path) {
        console.log(`      ${task.root_path}`);
      }
    }
    console.log();
  }

  // Recent tasks
  if (recent.length > 0) {
    console.log("  Recent tasks:\n");
    for (const task of recent) {
      const agentName = AGENT_NAMES[task.agent_slug] ?? task.agent_slug;
      const dur = duration(task.started_at, task.completed_at);
      const when = relativeTime(task.completed_at ?? task.started_at);
      const icon = statusIcon(task.status);

      console.log(
        `    ${icon} ${task.command_name} (${agentName}) — ${dur}, ${task.status} (${when})`
      );
      if (task.root_path) {
        console.log(`      ${task.root_path}`);
      }
      if (task.ai_diagnosis) {
        console.log(`      Diagnosis: ${task.ai_diagnosis}`);
      }
    }
    console.log();
  }

  if (active.length === 0 && recent.length > 0) {
    console.log("  No active tasks.\n");
  }

  await sql.end();
}
