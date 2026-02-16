import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const MIGRATIONS_DIR = join(PROJECT_ROOT, "docker/postgres/migrations");

function psqlQuery(sql: string): string {
  return execSync(
    "docker compose exec -T postgres psql -U murder -d murder -tA",
    { cwd: PROJECT_ROOT, input: sql, encoding: "utf-8" }
  ).trim();
}

function psqlExec(sql: string): void {
  execSync(
    "docker compose exec -T postgres psql -U murder -d murder -v ON_ERROR_STOP=1",
    { cwd: PROJECT_ROOT, input: sql, encoding: "utf-8", stdio: ["pipe", "ignore", "pipe"] }
  );
}

function tableExists(name: string): boolean {
  try {
    const result = psqlQuery(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${name}');`
    );
    return result === "t";
  } catch {
    return false;
  }
}

function ensureMigrationsTable(): boolean {
  const existed = tableExists("schema_migrations");
  if (!existed) {
    psqlExec(
      "CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
    );
  }
  return existed;
}

function getAppliedMigrations(): Set<string> {
  try {
    const result = psqlQuery(
      "SELECT filename FROM schema_migrations ORDER BY filename;"
    );
    if (!result) return new Set();
    return new Set(
      result
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function recordMigration(filename: string): void {
  psqlQuery(
    `INSERT INTO schema_migrations (filename) VALUES ('${filename}') ON CONFLICT DO NOTHING;`
  );
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  total: number;
  isFirstRun: boolean;
}

export function runMigrations(): MigrationResult {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const total = migrationFiles.length;
  if (total === 0) {
    return { applied: [], skipped: [], total: 0, isFirstRun: false };
  }

  const trackingExisted = ensureMigrationsTable();

  if (!trackingExisted) {
    // First time migration tracking is set up.
    // Check if the DB already has tables from Docker entrypoint.
    const dbHasTables = tableExists("projects");

    if (dbHasTables) {
      // Docker entrypoint already ran everything — just backfill the tracking table.
      for (const file of migrationFiles) {
        recordMigration(file);
      }
      return { applied: [], skipped: migrationFiles, total, isFirstRun: true };
    }

    // Truly fresh DB (entrypoint didn't run or volume was wiped). Execute all migrations.
    const applied: string[] = [];
    for (const file of migrationFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      psqlExec(sql);
      recordMigration(file);
      applied.push(file);
    }
    return { applied, skipped: [], total, isFirstRun: true };
  }

  // Tracking table already existed — run only pending migrations.
  const appliedSet = getAppliedMigrations();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of migrationFiles) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    psqlExec(sql);
    recordMigration(file);
    applied.push(file);
  }

  return { applied, skipped, total, isFirstRun: false };
}
