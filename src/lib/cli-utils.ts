import sql from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// (none yet — reserved for future shared CLI types)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIVIDER_LINE = "─".repeat(41);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function step(msg: string): void {
  console.log(`  ● ${msg}`);
}

export function ok(msg: string): void {
  console.log(`  ✓ ${msg}\n`);
}

export function fail(msg: string): void {
  console.log(`  ✗ ${msg}`);
}

export function divider(): void {
  console.log(`  ${DIVIDER_LINE}`);
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function getProjectId(cwd: string): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM projects WHERE root_path = ${cwd} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return (rows[0] as unknown as { id: string }).id;
}
