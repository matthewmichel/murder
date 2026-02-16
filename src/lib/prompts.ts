// ---------------------------------------------------------------------------
// Prompt builders for the murder new planning pipeline.
// Each returns a full dispatch prompt string for the Cursor CLI agent.
// ---------------------------------------------------------------------------

import { mkdirSync } from "fs";
import { join } from "path";
import type { Phase } from "./progress.js";

// ---------------------------------------------------------------------------
// Engineer Notes — persistent per-engineer notes that accumulate across phases
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to an engineer's running notes file and ensure
 * the parent directory exists. The engineer agent reads and writes this
 * file directly — no em-loop collection step needed.
 */
export function engineerNotesPath(planDir: string, engineer: "A" | "B"): string {
  const label = engineer === "A" ? "eng-a" : "eng-b";
  const notesDir = join(planDir, "notes");
  mkdirSync(notesDir, { recursive: true });
  return join(notesDir, `${label}.md`);
}

/**
 * Build the prompt for the PM agent.
 * The agent will analyze the request against project context and write a PRD.
 */
export function buildPmPrompt(
  userRequest: string,
  projectContext: string,
  outputPath: string
): string {
  return `# Murder PM Agent — Generate a PRD

You are acting as a senior Product Manager. A developer has submitted a feature request. Your job is to analyze it against the project's existing architecture and conventions, then produce a clear, structured PRD (Product Requirements Document).

## The Feature Request

${userRequest}

## Project Context

${projectContext}

## Your Task

Write a PRD as a markdown file to this exact path:

\`${outputPath}\`

The PRD must include these sections:

### Overview
A 2-3 sentence summary of what we're building and why.

### Goals
Bullet list of specific, measurable goals this feature achieves.

### Non-Goals
What this feature explicitly does NOT include (scope boundaries).

### User Stories
Concrete user stories in "As a [user], I want [action] so that [benefit]" format.

### Technical Considerations
Based on the project's architecture and conventions:
- What existing systems/modules does this touch?
- What new modules or files might be needed?
- Are there database changes required?
- Are there API changes required?
- What existing patterns should be followed?

### Acceptance Criteria
Specific, testable criteria that define "done." Each should be verifiable.

### Edge Cases & Risks
- What could go wrong?
- What edge cases need handling?
- Performance or security considerations?

## Rules

- Ground everything in the actual project context. Reference real files, modules, and patterns from this codebase.
- Be specific, not generic. Tailor the PRD to THIS project's stack and conventions.
- Keep it concise — every word should earn its place.
- Do NOT include implementation details or code. That's the engineer's job.
- You MUST create exactly one file at the path specified above.
- Do NOT create any other files.
`;
}

/**
 * Build the prompt for the EM (Engineering Manager) agent.
 * The agent will read the PRD, analyze the project, and produce a phased
 * execution plan (plan.md) AND a machine-readable progress file (progress.json).
 */
export function buildEmPrompt(
  prdPath: string,
  projectContext: string,
  planOutputPath: string,
  progressOutputPath: string,
  slug: string
): string {
  return `# Murder EM Agent — Generate an Execution Plan

You are acting as a senior Engineering Manager. A PRD has been written and you need to break it down into a phased execution plan for two AI coding agents ("Engineer A" and "Engineer B") who will implement the feature in parallel on the same machine using separate git worktrees.

## Your Inputs

1. **Read the PRD** at this path: \`${prdPath}\`
2. **Project context** is provided below.
3. **Read the actual source code** as needed to understand the codebase structure.

## Project Context

${projectContext}

## Critical Constraints

Both engineers work on the SAME machine in separate git worktrees. This means:
- They share the same local database instance (Supabase, Postgres, etc.)
- They share the same local ports (can't both run dev servers on the same port)
- They share the same local services (Docker containers, etc.)
- Database migrations from one engineer affect the other's worktree
- They cannot both modify the same files without causing merge conflicts
- Shared config files (package.json, tsconfig, etc.) are conflict-prone
- If one engineer installs a package, the other's node_modules may be stale

## Your Task — TWO files to create

You MUST create exactly two files:

### File 1: Execution Plan — \`${planOutputPath}\`

A markdown file following this exact structure:

\`\`\`markdown
# Execution Plan: <title>

## Overview
1-2 sentences summarizing the implementation approach.

## Constraints & Shared Resources
List every shared resource constraint you've identified for this specific project.

## Phase 1: <descriptive name>
> Gate: both engineers must complete all tasks in this phase before either moves to Phase 2.

### Engineer A: <focus area summary>
#### <Section Name>
- [ ] Specific task description with file paths where relevant
- [ ] Another task

#### <Another Section>
- [ ] Task description

### Engineer B: <focus area summary>
#### <Section Name>
- [ ] Specific task description with file paths where relevant
- [ ] Another task

## Phase 2: <descriptive name>
> Gate: both engineers must complete all tasks in this phase before either moves to Phase 3.

(same structure)

## Merge Strategy
Brief notes on how to merge the two lines of work after each phase.
\`\`\`

### File 2: Progress Tracker — \`${progressOutputPath}\`

A JSON file that mirrors the plan structure for machine tracking. It MUST match this exact schema:

\`\`\`json
{
  "slug": "${slug}",
  "status": "pending",
  "currentPhase": 0,
  "startedAt": null,
  "completedAt": null,
  "phases": [
    {
      "number": 1,
      "name": "<phase name — must match plan.md>",
      "status": "pending",
      "engineerA": {
        "focus": "<Engineer A focus area — must match plan.md>",
        "status": "pending",
        "taskId": null,
        "sections": [
          {
            "name": "<section name — must match plan.md>",
            "tasks": [
              { "description": "<task description — must match plan.md>", "completed": false }
            ]
          }
        ]
      },
      "engineerB": {
        "focus": "<Engineer B focus area — must match plan.md>",
        "status": "pending",
        "taskId": null,
        "sections": [
          {
            "name": "<section name — must match plan.md>",
            "tasks": [
              { "description": "<task description — must match plan.md>", "completed": false }
            ]
          }
        ]
      },
      "review": {
        "status": "pending",
        "taskId": null
      }
    }
  ]
}
\`\`\`

CRITICAL: The progress.json MUST be a 1:1 mirror of plan.md. Every phase, every engineer section, every task in plan.md must appear in progress.json. The task descriptions should match exactly.

## Planning Rules

1. **Separate by file ownership.** Engineer A and Engineer B should own different files/directories. If both need to touch the same file, put those changes in the same phase and call out the ordering explicitly.

2. **Database migrations go to ONE engineer per phase.** Never have both engineers creating migrations in the same phase.

3. **Phases are sequential gates.** Both engineers MUST finish the current phase before either starts the next.

4. **Earlier phases = foundation.** Put shared infrastructure, types, database schema, and config changes in Phase 1. Feature implementation in later phases. Integration and polish in the final phase.

5. **Tasks should be specific and actionable.** Include file paths, function names, and concrete descriptions.

6. **Be realistic about phases.** Most features need 2-4 phases. Don't over-decompose.

7. **Reference the project's actual architecture.** Use real directory paths, file naming conventions, and patterns from the project context and source code.

## Rules

- Read the PRD thoroughly before planning.
- Read the actual source code to understand the codebase structure.
- You MUST create exactly TWO files at the paths specified above.
- Do NOT create any other files.
- Do NOT modify any existing files.
`;
}

// ---------------------------------------------------------------------------
// Engineering Agent Prompts
// ---------------------------------------------------------------------------

function formatPhaseTasks(phase: Phase, engineer: "A" | "B"): string {
  const eng = engineer === "A" ? phase.engineerA : phase.engineerB;
  const lines: string[] = [];

  lines.push(`## Your Assignment: ${eng.focus}`);
  lines.push("");

  for (const section of eng.sections) {
    lines.push(`### ${section.name}`);
    for (const task of section.tasks) {
      lines.push(`- [ ] ${task.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build the prompt for an engineering agent working on a specific phase.
 */
export function buildEngineerPrompt(
  engineer: "A" | "B",
  phase: Phase,
  prdContent: string,
  projectContext: string,
  notesPath: string
): string {
  const taskBlock = formatPhaseTasks(phase, engineer);

  return `# Murder Engineering Agent — Engineer ${engineer}

You are Engineer ${engineer}, an AI coding agent implementing Phase ${phase.number}: "${phase.name}".

You are working in a **git worktree** — a separate checkout of the repository on a dedicated branch. Another engineer is working in parallel on a different branch. You must stay within your assigned scope to avoid merge conflicts.

## Your Tasks for This Phase

${taskBlock}

## Running Notes

Your running notes file is at:

\`${notesPath}\`

**Read this file first** if it exists — it contains your own notes from previous phases (decisions, patterns, gotchas). Then **update it before you finish** with anything the next phase should know. Keep it concise but useful.

## PRD (for context)

${prdContent}

## Project Context

${projectContext}

## Rules

1. **Complete every task** listed in your assignment above. Work through them in order.
2. **Stay in scope.** Only modify files related to your assigned tasks. Do NOT touch files assigned to the other engineer.
3. **Follow existing patterns.** Read the codebase to understand conventions before writing new code. Match the style, naming, and structure of existing code.
4. **Commit your work.** When you have completed all tasks, stage and commit your changes with a clear commit message describing what you built.
5. **Run validation commands** if they exist in \`.murder/config.ts\` — typecheck, lint, test. Fix any errors your changes introduce.
6. **Do NOT modify** \`.murder/\` files (other than your notes file above), \`progress.json\`, or any git configuration.
7. **Do NOT install new packages** unless explicitly required by your tasks. If you must install a package, note it clearly in your commit message.
`;
}

// ---------------------------------------------------------------------------
// EM Review Agent Prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the EM review agent that runs after both engineers
 * complete a phase. Responsible for validating integration and resolving
 * any merge conflicts.
 */
export function buildEmReviewPrompt(
  phase: Phase,
  slug: string,
  phaseNumber: number,
  projectContext: string,
  hasConflicts: boolean,
  conflictFiles: string[]
): string {
  const featureBranch = `murder/${slug}`;
  const conflictBlock = hasConflicts
    ? `## MERGE CONFLICTS DETECTED

The following files have merge conflicts that you MUST resolve:

${conflictFiles.map((f) => `- \`${f}\``).join("\n")}

Resolve each conflict by examining both sides and producing correct, working code. After resolving, stage the files and complete the merge commit.
`
    : `## Merge Status

The merge was clean — no conflicts detected. Focus on validation and integration review.
`;

  return `# Murder EM Review Agent — Phase ${phaseNumber} Review

You are the Engineering Manager reviewing the combined work of two engineers after Phase ${phaseNumber}: "${phase.name}".

Both engineers have completed their tasks on separate branches. Their work has been merged into the feature branch \`${featureBranch}\`.

${conflictBlock}

## What Was Built

### Engineer A: ${phase.engineerA.focus}
${phase.engineerA.sections.map((s) => `- ${s.name}: ${s.tasks.length} task(s)`).join("\n")}

### Engineer B: ${phase.engineerB.focus}
${phase.engineerB.sections.map((s) => `- ${s.name}: ${s.tasks.length} task(s)`).join("\n")}

## Project Context

${projectContext}

## Your Tasks

1. **If there are merge conflicts**, resolve them cleanly. Examine both engineers' intent and produce correct merged code. Stage resolved files and commit.

2. **Run validation commands** from \`.murder/config.ts\` if present:
   - Typecheck
   - Lint
   - Test
   - Build

3. **Fix integration issues.** If the combined code from both engineers has integration problems (type mismatches, broken imports, incompatible changes), fix them.

4. **Commit any fixes** with a clear message like "Phase ${phaseNumber} integration: fix [description]".

## Rules

- Do NOT refactor or improve code beyond what's needed for integration.
- Do NOT start work on the next phase — only review and fix the current phase.
- Keep changes minimal and focused on making the combined work compile and pass tests.
`;
}
