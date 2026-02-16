import { execSync } from "child_process";
import sql from "./db.js";
import { promptSingleSelect } from "./prompt.js";

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  slug: string;
  name: string;
  command: string;
  versionFlag: string;
  installHint: string;
}

export interface DetectedAgent {
  slug: string;
  name: string;
  command: string;
  path: string;
  version: string;
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
// Detection
// ---------------------------------------------------------------------------

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

export function detectAgent(def: AgentDefinition): DetectedAgent | null {
  const path = resolveCommand(def.command);
  if (!path) return null;

  const version = getVersion(def.command, def.versionFlag) ?? "unknown";

  return {
    slug: def.slug,
    name: def.name,
    command: def.command,
    path,
    version,
  };
}

export function detectAllAgents(): {
  found: DetectedAgent[];
  missing: AgentDefinition[];
} {
  const found: DetectedAgent[] = [];
  const missing: AgentDefinition[] = [];

  for (const def of KNOWN_AGENTS) {
    const result = detectAgent(def);
    if (result) {
      found.push(result);
    } else {
      missing.push(def);
    }
  }

  return { found, missing };
}

// ---------------------------------------------------------------------------
// Interactive menu (delegates to shared prompt utilities)
// ---------------------------------------------------------------------------

export async function promptForDefault(
  agents: DetectedAgent[]
): Promise<DetectedAgent> {
  if (agents.length === 1) return agents[0];

  const items = agents.map((a) => ({ label: a.name }));
  const idx = await promptSingleSelect(items, "Select your default agent:");
  return agents[idx];
}

// ---------------------------------------------------------------------------
// Database registration
// ---------------------------------------------------------------------------

export async function registerAgentBackends(
  found: DetectedAgent[],
  defaultSlug: string
): Promise<void> {
  for (const agent of found) {
    await sql`
      INSERT INTO agent_backends (slug, name, cli_command, cli_path, version, is_available, is_default, detected_at)
      VALUES (
        ${agent.slug},
        ${agent.name},
        ${agent.command},
        ${agent.path},
        ${agent.version},
        true,
        ${agent.slug === defaultSlug},
        NOW()
      )
      ON CONFLICT (slug) DO UPDATE SET
        cli_command = EXCLUDED.cli_command,
        cli_path = EXCLUDED.cli_path,
        version = EXCLUDED.version,
        is_available = true,
        is_default = ${agent.slug === defaultSlug},
        detected_at = NOW()
    `;
  }

  // Mark any previously-registered agents that are no longer found as unavailable
  const foundSlugs = found.map((a) => a.slug);
  if (foundSlugs.length > 0) {
    await sql`
      UPDATE agent_backends
      SET is_available = false, is_default = false
      WHERE slug != ALL(${foundSlugs})
    `;
  } else {
    await sql`
      UPDATE agent_backends
      SET is_available = false, is_default = false
    `;
  }
}

// ---------------------------------------------------------------------------
// Public: all known agents (for install hints)
// ---------------------------------------------------------------------------

export { KNOWN_AGENTS };
