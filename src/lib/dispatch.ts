import { spawn, type ChildProcess } from "child_process";
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "fs";
import { join, relative } from "path";
import { randomUUID } from "crypto";
import sql from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBackend {
  slug: string;
  name: string;
  cli_command: string;
  cli_path: string;
  version: string;
  preferred_model?: string | null;
}

export interface TaskHandle {
  taskId: string;
  pid: number;
  logPath: string;
  process: ChildProcess;
  agentSlug: string;
  agentName: string;
  startedAt: number;
  done: Promise<{ exitCode: number }>;
}

// ---------------------------------------------------------------------------
// Agent queries
// ---------------------------------------------------------------------------

export async function getDefaultAgent(): Promise<AgentBackend | null> {
  const rows = await sql`
    SELECT slug, name, cli_command, cli_path, version, preferred_model
    FROM agent_backends
    WHERE is_available = true AND is_default = true
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return rows[0] as unknown as AgentBackend;
}

export async function getAvailableAgents(): Promise<AgentBackend[]> {
  const rows = await sql`
    SELECT slug, name, cli_command, cli_path, version, preferred_model
    FROM agent_backends
    WHERE is_available = true
    ORDER BY is_default DESC, name ASC
  `;
  return rows as unknown as AgentBackend[];
}

// ---------------------------------------------------------------------------
// Task DB operations
// ---------------------------------------------------------------------------

async function insertTask(
  taskId: string,
  projectId: string,
  agentSlug: string,
  commandName: string,
  prompt: string,
  pid: number,
  logPath: string
): Promise<void> {
  await sql`
    INSERT INTO tasks (id, project_id, agent_slug, command_name, prompt, pid, status, log_path, last_output_at, started_at)
    VALUES (
      ${taskId}::uuid,
      ${projectId}::uuid,
      ${agentSlug},
      ${commandName},
      ${prompt},
      ${pid},
      'running',
      ${logPath},
      NOW(),
      NOW()
    )
  `;
}

export async function updateTaskOutput(
  taskId: string,
  outputBytes: number
): Promise<void> {
  await sql`
    UPDATE tasks
    SET output_bytes = ${outputBytes}, last_output_at = NOW()
    WHERE id = ${taskId}::uuid
  `;
}

export async function completeTask(
  taskId: string,
  exitCode: number,
  status: "completed" | "failed"
): Promise<void> {
  await sql`
    UPDATE tasks
    SET status = ${status}, exit_code = ${exitCode}, completed_at = NOW()
    WHERE id = ${taskId}::uuid
  `;
}

export async function markTaskStuck(
  taskId: string,
  diagnosis: string
): Promise<void> {
  await sql`
    UPDATE tasks
    SET status = 'stuck', ai_diagnosis = ${diagnosis}
    WHERE id = ${taskId}::uuid
  `;
}

export async function markTaskKilled(
  taskId: string,
  diagnosis: string
): Promise<void> {
  await sql`
    UPDATE tasks
    SET status = 'killed', ai_diagnosis = ${diagnosis}, completed_at = NOW()
    WHERE id = ${taskId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// Dispatch options
// ---------------------------------------------------------------------------

export type OutputFormat = "inherit" | "stream-json" | "pipe";

export interface DispatchOptions {
  /**
   * How to handle agent output:
   * - "inherit":     Full terminal pass-through (agent gets real TTY)
   * - "stream-json": Structured JSON events parsed into progress display
   * - "pipe":        Capture to log file silently (default, for background tasks)
   */
  outputFormat?: OutputFormat;
  /**
   * Optional label prefix for stream-json display (e.g. "Eng A", "Eng B").
   * When set, each displayed event line is prefixed with [label].
   */
  label?: string;
}

// ---------------------------------------------------------------------------
// Stream-JSON event display
// ---------------------------------------------------------------------------

function shortenPath(fullPath: string | undefined, cwd: string): string {
  if (!fullPath) return "unknown";
  try {
    const rel = relative(cwd, fullPath);
    return rel.startsWith("..") ? fullPath : rel;
  } catch {
    return fullPath;
  }
}

function displayStreamEvent(line: string, cwd: string, label?: string): boolean {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  const type = event.type as string | undefined;
  const subtype = event.subtype as string | undefined;
  const tag = label ? `\x1B[2m[${label}]\x1B[22m ` : "";

  switch (type) {
    case "system": {
      if (subtype === "init") {
        const model = (event.model as string) || "unknown";
        console.log(`    ${tag}model: ${model}`);
      }
      break;
    }

    case "tool_call": {
      const tc = event.tool_call as Record<string, unknown> | undefined;
      if (!tc) break;

      if (subtype === "started") {
        if (tc.readToolCall) {
          const args = (tc.readToolCall as Record<string, unknown>).args as Record<string, unknown> | undefined;
          console.log(`    ${tag}\u25CB read  ${shortenPath(args?.path as string, cwd)}`);
        } else if (tc.writeToolCall) {
          const args = (tc.writeToolCall as Record<string, unknown>).args as Record<string, unknown> | undefined;
          console.log(`    ${tag}\u25CB write ${shortenPath(args?.path as string, cwd)}`);
        } else if (tc.editToolCall) {
          const args = (tc.editToolCall as Record<string, unknown>).args as Record<string, unknown> | undefined;
          console.log(`    ${tag}\u25CB edit  ${shortenPath(args?.path as string, cwd)}`);
        } else if (tc.bashToolCall || tc.shellToolCall) {
          console.log(`    ${tag}\u25CB shell command`);
        } else if (tc.globToolCall) {
          console.log(`    ${tag}\u25CB glob search`);
        } else if (tc.grepToolCall) {
          console.log(`    ${tag}\u25CB grep search`);
        } else if (tc.listToolCall) {
          console.log(`    ${tag}\u25CB list directory`);
        }
      } else if (subtype === "completed") {
        if (tc.writeToolCall) {
          const result = (tc.writeToolCall as Record<string, unknown>).result as Record<string, unknown> | undefined;
          const success = result?.success as Record<string, unknown> | undefined;
          if (success) {
            const lines = success.linesCreated ?? success.totalLines ?? "";
            const size = success.fileSize;
            const details: string[] = [];
            if (lines) details.push(`${lines} lines`);
            if (size) details.push(`${size} bytes`);
            if (details.length) {
              console.log(`      ${tag}\u2713 ${details.join(", ")}`);
            }
          }
        }
      }
      break;
    }

    case "result": {
      const durationMs = event.duration_ms as number | undefined;
      if (durationMs) {
        const secs = (durationMs / 1000).toFixed(1);
        console.log(`    ${tag}\u25CF done (${secs}s)`);
      }
      break;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Dispatch — spawns agent with output capture
// ---------------------------------------------------------------------------

/**
 * Write the prompt to a temp file and return its path.
 * This avoids shell argument length issues with long prompts.
 */
function writePromptFile(logsDir: string, taskId: string, prompt: string): string {
  const promptPath = join(logsDir, `${taskId}.prompt`);
  writeFileSync(promptPath, prompt, "utf-8");
  return promptPath;
}

/**
 * Build a shell command string for the given output format.
 * Currently only supports Cursor CLI (agent command).
 *
 * When a preferred_model is set (and is not "auto"), prepends --model <name>
 * before -p so the agent uses the specified model.
 */
function buildShellCommand(
  agent: AgentBackend,
  promptFilePath: string,
  outputFormat: OutputFormat,
  preferredModel?: string | null
): string {
  const promptArg = `"$(cat '${promptFilePath}')"`;
  const modelFlag =
    preferredModel && preferredModel !== "auto"
      ? `--model ${preferredModel} `
      : "";

  if (outputFormat === "stream-json") {
    return `${agent.cli_command} ${modelFlag}-p --force --output-format stream-json ${promptArg}`;
  }

  return `${agent.cli_command} ${modelFlag}-p --force ${promptArg}`;
}

/**
 * Dispatch a prompt to an agent backend.
 *
 * Output modes:
 * - "pipe" (default): stdout/stderr captured to log file, spinner shown
 * - "inherit": agent gets direct terminal access (full TTY)
 * - "stream-json": agent outputs NDJSON events, parsed into progress display
 *
 * Returns a TaskHandle for monitoring.
 */
export async function dispatchAgent(
  agent: AgentBackend,
  prompt: string,
  cwd: string,
  projectId: string,
  commandName: string = "task",
  options: DispatchOptions = {}
): Promise<TaskHandle> {
  const outputFormat = options.outputFormat ?? "pipe";
  const label = options.label;
  const taskId = randomUUID();

  const logsDir = join(cwd, ".murder", "logs");
  mkdirSync(logsDir, { recursive: true });
  const logPath = join(logsDir, `${taskId}.log`);

  const promptFilePath = writePromptFile(logsDir, taskId, prompt);
  const shellCmd = buildShellCommand(agent, promptFilePath, outputFormat, agent.preferred_model);

  let logStream: WriteStream | null = null;

  const stdio = outputFormat === "inherit"
    ? ("inherit" as const)
    : (["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"]);

  const proc = spawn("/bin/sh", ["-c", shellCmd], {
    cwd,
    stdio,
    env: { ...process.env },
  });

  if (outputFormat === "inherit") {
    writeFileSync(logPath, `[murder] Output streamed to terminal.\n`);
  } else {
    proc.stdin?.end();
    logStream = createWriteStream(logPath, { flags: "a" });

    if (outputFormat === "stream-json") {
      let lineBuf = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        logStream!.write(chunk);
        lineBuf += chunk.toString();

        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) displayStreamEvent(line, cwd, label);
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        logStream!.write(chunk);
      });
    } else {
      proc.stdout?.on("data", (chunk: Buffer) => {
        logStream!.write(chunk);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        logStream!.write(chunk);
      });
    }
  }

  const startedAt = Date.now();

  const done = new Promise<{ exitCode: number }>((resolve) => {
    proc.on("close", (code) => {
      logStream?.end();
      resolve({ exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      if (logStream) {
        logStream.write(`\n[murder] Process error: ${err.message}\n`);
        logStream.end();
      }
      resolve({ exitCode: 1 });
    });
  });

  const pid = proc.pid ?? 0;

  await insertTask(
    taskId,
    projectId,
    agent.slug,
    commandName,
    prompt,
    pid,
    logPath
  );

  return {
    taskId,
    pid,
    logPath,
    process: proc,
    agentSlug: agent.slug,
    agentName: agent.name,
    startedAt,
    done,
  };
}
