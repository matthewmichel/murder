import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectContext {
  agentsMd: boolean;
  architecture: boolean;
  coreBeliefs: boolean;
  config: boolean;
  pmMd: boolean;
  emMd: boolean;
  futureMd: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileExistsAndNonEmpty(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const content = readFileSync(path, "utf-8").trim();
    return content.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Knowledge file descriptors
// ---------------------------------------------------------------------------

const KNOWLEDGE_FILES: {
  key: keyof ProjectContext;
  relativePath: string;
  description: string;
  instruction: string;
}[] = [
  {
    key: "agentsMd",
    relativePath: "AGENTS.md",
    description: "Tech stack, directory structure, validation commands, and key conventions.",
    instruction: "Read this file first to understand the project.",
  },
  {
    key: "architecture",
    relativePath: ".murder/ARCHITECTURE.md",
    description: "System architecture, data flow, dependency graph, and database schema.",
    instruction: "Read this file for architectural context.",
  },
  {
    key: "coreBeliefs",
    relativePath: ".murder/core-beliefs.md",
    description: "Code style conventions, patterns, and what NOT to do.",
    instruction: "Read this file for coding conventions.",
  },
  {
    key: "config",
    relativePath: ".murder/config.ts",
    description: "Validation commands (typecheck, lint, test, build) and boot/database configuration.",
    instruction: "Read this file for validation and infrastructure config.",
  },
  {
    key: "pmMd",
    relativePath: ".murder/PM.md",
    description: "Product knowledge, user flows, business rules, and product decisions.",
    instruction: "Read this file for product context.",
  },
  {
    key: "emMd",
    relativePath: ".murder/EM.md",
    description: "Engineering knowledge, technical architecture, code patterns, and technical debt.",
    instruction: "Read this file for engineering context.",
  },
  {
    key: "futureMd",
    relativePath: ".murder/FUTURE.md",
    description: "Planned features, roadmap, and future direction.",
    instruction: "Read this file for roadmap and future plans.",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check the .murder/ knowledge structure and AGENTS.md from a project directory.
 * Returns boolean values indicating whether each knowledge file exists and is
 * non-empty. File contents are NOT read into memory — agents retrieve them
 * on demand using their file-reading tools.
 */
export function assembleProjectContext(cwd: string): ProjectContext {
  const ctx = {} as ProjectContext;
  for (const file of KNOWLEDGE_FILES) {
    ctx[file.key] = fileExistsAndNonEmpty(join(cwd, file.relativePath));
  }
  return ctx;
}

/**
 * Format the project context as a concise table of contents for prompt
 * injection. Lists each detected knowledge file with its path and a brief
 * description, so agents know what's available and can read files on demand.
 */
export function formatContextForPrompt(ctx: ProjectContext): string {
  const entries: string[] = [];

  for (const file of KNOWLEDGE_FILES) {
    if (ctx[file.key]) {
      entries.push(
        `- **\`${file.relativePath}\`** — ${file.description} ${file.instruction}`
      );
    }
  }

  if (entries.length === 0) {
    return "(No project context available. Run `murder init` first.)";
  }

  return [
    "The following knowledge files are available in this project. Use your file-reading tools to read the ones relevant to your task:",
    "",
    ...entries,
  ].join("\n");
}
