import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { execSync } from "child_process";
import sql from "../lib/db.server";

interface AgentBackend {
  id: string;
  slug: string;
  name: string;
  cli_command: string;
  cli_path: string | null;
  version: string | null;
  preferred_model: string | null;
  is_available: boolean;
  is_default: boolean;
  detected_at: string;
}

interface AgentDefinition {
  slug: string;
  name: string;
  command: string;
  versionFlag: string;
  installHint: string;
}

const KNOWN_AGENTS: AgentDefinition[] = [
  {
    slug: "cursor-cli",
    name: "Cursor CLI",
    command: "agent",
    versionFlag: "--version",
    installHint: "curl https://cursor.com/install -fsS | bash",
  },
];

// ---------------------------------------------------------------------------
// Cursor CLI model list — duplicated from src/lib/models.ts (source of truth)
// Keep in sync when models are added/removed there.
// ---------------------------------------------------------------------------
interface CursorCliModel {
  value: string;
  label: string;
  hint?: string;
}

const CURSOR_CLI_MODELS: CursorCliModel[] = [
  { value: "auto", label: "Auto (Cursor default)", hint: "Let Cursor pick the best model" },

  // Anthropic — Claude
  { value: "claude-4.6-opus", label: "Claude 4.6 Opus", hint: "Most capable" },
  { value: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", hint: "Balanced" },
  { value: "claude-4.5-haiku", label: "Claude 4.5 Haiku", hint: "Balanced" },

  // OpenAI — GPT
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", hint: "Code-focused" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", hint: "Code-focused" },

  // Cursor
  { value: "composer-1.5", label: "Composer 1.5", hint: "Fast, lightweight" },
];

function resolveCommand(command: string): string | null {
  try {
    return execSync(`which ${command}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function getVersion(command: string, flag: string): string | null {
  try {
    const output = execSync(`${command} ${flag}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export async function loader() {
  const rows = await sql`
    SELECT id, slug, name, cli_command, cli_path, version,
           preferred_model, is_available, is_default, detected_at
    FROM agent_backends
    ORDER BY is_default DESC, name ASC
  `;
  return { agents: rows as unknown as AgentBackend[] };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "re-detect") {
    const found: { slug: string; name: string; command: string; path: string; version: string }[] = [];

    for (const def of KNOWN_AGENTS) {
      const path = resolveCommand(def.command);
      if (!path) continue;
      const version = getVersion(def.command, def.versionFlag) ?? "unknown";
      found.push({ slug: def.slug, name: def.name, command: def.command, path, version });
    }

    for (const agent of found) {
      await sql`
        INSERT INTO agent_backends (slug, name, cli_command, cli_path, version, is_available, detected_at)
        VALUES (${agent.slug}, ${agent.name}, ${agent.command}, ${agent.path}, ${agent.version}, true, NOW())
        ON CONFLICT (slug) DO UPDATE SET
          cli_command = EXCLUDED.cli_command,
          cli_path = EXCLUDED.cli_path,
          version = EXCLUDED.version,
          is_available = true,
          detected_at = NOW()
      `;
    }

    const foundSlugs = found.map((a) => a.slug);
    if (foundSlugs.length > 0) {
      await sql`
        UPDATE agent_backends
        SET is_available = false, is_default = false
        WHERE slug != ALL(${foundSlugs})
      `;
    } else {
      await sql`UPDATE agent_backends SET is_available = false, is_default = false`;
    }

    return { success: `Detected ${found.length} agent(s).` };
  }

  if (intent === "set-model") {
    const agentId = form.get("agentId") as string;
    const model = form.get("model") as string;
    if (!agentId) return { error: "Agent ID required." };

    const preferred = !model || model === "auto" ? null : model;
    await sql`
      UPDATE agent_backends
      SET preferred_model = ${preferred}
      WHERE id = ${agentId}::uuid
    `;
    return { success: `Model updated to ${preferred ?? "Auto"}.` };
  }

  if (intent === "set-default") {
    const agentId = form.get("agentId") as string;
    if (!agentId) return { error: "Agent ID required." };

    await sql`UPDATE agent_backends SET is_default = false`;
    await sql`UPDATE agent_backends SET is_default = true WHERE id = ${agentId}::uuid`;
    return { success: "Default agent updated." };
  }

  return { error: "Unknown action." };
}

export default function Agents() {
  const { agents } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Agent Backends</h2>
        <Form method="post">
          <input type="hidden" name="intent" value="re-detect" />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Scanning..." : "Re-detect Agents"}
          </button>
        </Form>
      </div>

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

      {agents.length === 0 ? (
        <div className="card bg-base-200">
          <div className="card-body">
            <p className="text-base-content/60">
              No agents detected yet. Click "Re-detect Agents" to scan for
              installed AI coding agents.
            </p>
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Supported agents:</p>
              {KNOWN_AGENTS.map((def) => (
                <div key={def.slug} className="flex items-center gap-3 text-sm">
                  <span className="font-medium w-28">{def.name}</span>
                  <code className="text-xs text-base-content/50">
                    {def.installHint}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Command</th>
                <th>Path</th>
                <th>Version</th>
                <th>Model</th>
                <th>Status</th>
                <th>Default</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td className="font-medium">{agent.name}</td>
                  <td>
                    <code className="text-xs">{agent.cli_command}</code>
                  </td>
                  <td>
                    <code className="text-xs text-base-content/50">
                      {agent.cli_path ?? "—"}
                    </code>
                  </td>
                  <td>
                    <code className="text-xs">{agent.version ?? "—"}</code>
                  </td>
                  <td>
                    {agent.is_available ? (
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="set-model" />
                        <input type="hidden" name="agentId" value={agent.id} />
                        <select
                          name="model"
                          className="select select-bordered select-xs w-48"
                          defaultValue={agent.preferred_model ?? "auto"}
                          onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        >
                          {CURSOR_CLI_MODELS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}{m.hint ? ` — ${m.hint}` : ""}
                            </option>
                          ))}
                          {agent.preferred_model &&
                            !CURSOR_CLI_MODELS.some((m) => m.value === agent.preferred_model) && (
                              <option value={agent.preferred_model}>
                                {agent.preferred_model} (custom)
                              </option>
                            )}
                        </select>
                      </Form>
                    ) : (
                      <span className="text-xs text-base-content/50">
                        {agent.preferred_model ?? "Auto"}
                      </span>
                    )}
                  </td>
                  <td>
                    {agent.is_available ? (
                      <span className="badge badge-success badge-sm">
                        available
                      </span>
                    ) : (
                      <span className="badge badge-error badge-sm">
                        unavailable
                      </span>
                    )}
                  </td>
                  <td>
                    {agent.is_default && (
                      <span className="badge badge-primary badge-sm">
                        default
                      </span>
                    )}
                  </td>
                  <td>
                    {agent.is_available && !agent.is_default && (
                      <Form method="post" className="inline">
                        <input
                          type="hidden"
                          name="intent"
                          value="set-default"
                        />
                        <input
                          type="hidden"
                          name="agentId"
                          value={agent.id}
                        />
                        <button
                          type="submit"
                          className="btn btn-ghost btn-xs"
                          disabled={isSubmitting}
                        >
                          Set Default
                        </button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
