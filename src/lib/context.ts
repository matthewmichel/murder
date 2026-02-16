import { readFileSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectContext {
  architecture: string | null;
  coreBeliefs: string | null;
  config: string | null;
  agentsMd: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the .murder/ knowledge structure and AGENTS.md from a project directory.
 * Returns individual file contents (null if missing) plus a formatted block
 * ready to inject into AI prompts.
 */
export function assembleProjectContext(cwd: string): ProjectContext {
  return {
    architecture: readIfExists(join(cwd, ".murder", "ARCHITECTURE.md")),
    coreBeliefs: readIfExists(join(cwd, ".murder", "core-beliefs.md")),
    config: readIfExists(join(cwd, ".murder", "config.ts")),
    agentsMd: readIfExists(join(cwd, "AGENTS.md")),
  };
}

/**
 * Format the project context into a single string block for prompt injection.
 * Skips any files that weren't found.
 */
export function formatContextForPrompt(ctx: ProjectContext): string {
  const sections: string[] = [];

  if (ctx.agentsMd) {
    sections.push(`## AGENTS.md\n\n${ctx.agentsMd}`);
  }

  if (ctx.architecture) {
    sections.push(`## Architecture\n\n${ctx.architecture}`);
  }

  if (ctx.coreBeliefs) {
    sections.push(`## Core Beliefs & Conventions\n\n${ctx.coreBeliefs}`);
  }

  if (ctx.config) {
    sections.push(`## Project Config (.murder/config.ts)\n\n\`\`\`typescript\n${ctx.config}\n\`\`\``);
  }

  if (sections.length === 0) {
    return "(No project context available. Run `murder init` first.)";
  }

  return sections.join("\n\n---\n\n");
}
