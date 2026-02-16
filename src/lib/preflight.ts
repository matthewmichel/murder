import { execSync } from "child_process";
import type { AgentBackend } from "./dispatch.js";

// ---------------------------------------------------------------------------
// Pre-flight check result
// ---------------------------------------------------------------------------

export interface PreflightResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Per-agent smoke tests
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 15_000;

function runSmoke(
  command: string,
  args: string[],
  cwd: string
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(`${command} ${args.join(" ")}`, {
      cwd,
      encoding: "utf-8",
      timeout: TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };

    if (e.killed) {
      return {
        ok: false,
        stdout: "",
        stderr: `Timed out after ${TIMEOUT_MS / 1000}s`,
      };
    }

    return {
      ok: false,
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? e.message ?? "Unknown error").toString().trim(),
    };
  }
}

function parseFailure(stderr: string, stdout: string): string {
  const combined = `${stderr}\n${stdout}`.toLowerCase();

  if (
    combined.includes("not authenticated") ||
    combined.includes("not logged in") ||
    combined.includes("/login") ||
    combined.includes("log in") ||
    combined.includes("sign in") ||
    combined.includes("authenticate")
  ) {
    return "Not authenticated. Run the agent CLI manually first to log in.";
  }

  if (
    combined.includes("api key") ||
    combined.includes("api_key")
  ) {
    return "API key not configured. Set the required environment variable or log in via the agent CLI.";
  }

  if (
    combined.includes("command not found") ||
    combined.includes("enoent")
  ) {
    return "Command not found. The agent CLI may not be installed correctly.";
  }

  if (combined.includes("timed out")) {
    return "Agent did not respond within 15 seconds. It may be hung or require interactive setup.";
  }

  if (
    combined.includes("rate limit") ||
    combined.includes("429")
  ) {
    return "Rate limited. Wait a moment and try again.";
  }

  return stderr || "Unknown error during pre-flight check.";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a quick smoke test to verify the agent CLI is responsive and
 * authenticated before committing to a full dispatch.
 */
export function preflightCheck(
  agent: AgentBackend,
  cwd: string
): PreflightResult {
  const args: string[] = [];

  if (agent.preferred_model && agent.preferred_model !== "auto") {
    args.push("--model", agent.preferred_model);
  }

  args.push("-p", "--force", '"respond with OK"');
  const result = runSmoke(agent.cli_command, args, cwd);

  if (result.ok) {
    return { ok: true, message: `${agent.name} is responsive` };
  }

  const diagnosis = parseFailure(result.stderr, result.stdout);
  return { ok: false, message: diagnosis };
}
