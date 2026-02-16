// ---------------------------------------------------------------------------
// Prompt builders for the murder new planning pipeline.
// Each returns a full dispatch prompt string for the Cursor CLI agent.
// ---------------------------------------------------------------------------

import { mkdirSync } from "fs";
import { join } from "path";
import type { Phase } from "./progress.js";

// ---------------------------------------------------------------------------
// Engineer Notes — persistent notes that accumulate across phases
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to the engineer's running notes file and ensure
 * the parent directory exists. The engineer agent reads and writes this
 * file directly — no em-loop collection step needed.
 */
export function engineerNotesPath(planDir: string): string {
  const notesDir = join(planDir, "notes");
  mkdirSync(notesDir, { recursive: true });
  return join(notesDir, "engineer.md");
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
 *
 * The plan is for a SINGLE engineer who executes each phase sequentially.
 * The EM reviews after each phase before the engineer proceeds.
 */
export function buildEmPrompt(
  prdPath: string,
  projectContext: string,
  planOutputPath: string,
  progressOutputPath: string,
  slug: string
): string {
  return `# Murder EM Agent — Generate an Execution Plan

You are acting as a senior Engineering Manager. A PRD has been written and you need to break it down into a phased execution plan for a single AI coding agent (the "Engineer") who will implement the feature. After each phase, you (the EM) will review the engineer's work before they proceed to the next phase.

## Your Inputs

1. **Read the PRD** at this path: \`${prdPath}\`
2. **Project context** is provided below.
3. **Read the actual source code** as needed to understand the codebase structure.

## Project Context

${projectContext}

## Your Task — TWO files to create

You MUST create exactly two files:

### File 1: Execution Plan — \`${planOutputPath}\`

A markdown file following this exact structure:

\`\`\`markdown
# Execution Plan: <title>

## Overview
1-2 sentences summarizing the implementation approach.

## Phase 1: <descriptive name>
> The EM will review the engineer's work after this phase before proceeding.

### <Section Name>
- [ ] Specific task description with file paths where relevant
- [ ] Another task

### <Another Section>
- [ ] Task description

## Phase 2: <descriptive name>
> The EM will review the engineer's work after this phase before proceeding.

### <Section Name>
- [ ] Task description

(etc.)
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
      "engineer": {
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

CRITICAL: The progress.json MUST be a 1:1 mirror of plan.md. Every phase, every section, every task in plan.md must appear in progress.json. The task descriptions should match exactly.

## Planning Rules

1. **Phases are sequential gates.** The engineer completes a phase, then the EM reviews it before the next phase begins. Use this to catch issues early.

2. **Earlier phases = foundation.** Put shared infrastructure, types, database schema, and config changes in Phase 1. Feature implementation in later phases. Integration and polish in the final phase.

3. **Tasks should be specific and actionable.** Include file paths, function names, and concrete descriptions. The engineer is an AI coding agent — give it clear, unambiguous instructions.

4. **Be realistic about phases.** Most features need 2-4 phases. Don't over-decompose into too many tiny phases, but don't cram everything into one phase either. Each phase should be a coherent chunk of work that can be validated independently.

5. **Reference the project's actual architecture.** Use real directory paths, file naming conventions, and patterns from the project context and source code.

6. **Group related changes.** Since one engineer does all the work, group tasks by logical area within each phase (e.g. a section for database changes, a section for API changes, a section for UI changes).

## Rules

- Read the PRD thoroughly before planning.
- Read the actual source code to understand the codebase structure.
- You MUST create exactly TWO files at the paths specified above.
- Do NOT create any other files.
- Do NOT modify any existing files.
`;
}

// ---------------------------------------------------------------------------
// Engineering Agent Prompt
// ---------------------------------------------------------------------------

function formatPhaseTasks(phase: Phase): string {
  const eng = phase.engineer;
  const lines: string[] = [];

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
 * Build the prompt for the engineering agent working on a specific phase.
 */
export function buildEngineerPrompt(
  phase: Phase,
  prdContent: string,
  projectContext: string,
  notesPath: string
): string {
  const taskBlock = formatPhaseTasks(phase);

  return `# Murder Engineering Agent — Phase ${phase.number}

You are an AI coding agent implementing Phase ${phase.number}: "${phase.name}".

You are working on a feature branch in a git worktree. Complete all tasks for this phase, then commit your work.

## Your Tasks for This Phase

${taskBlock}

## Running Notes

Your running notes file is at:

\`${notesPath}\`

**Read this file first** if it exists — it contains your notes from previous phases (decisions made, patterns discovered, gotchas encountered). Then **update it before you finish** with anything the next phase should know. Keep it concise but useful.

## PRD (for context)

${prdContent}

## Project Context

${projectContext}

## Rules

1. **Complete every task** listed above. Work through them in order.
2. **Follow existing patterns.** Read the codebase to understand conventions before writing new code. Match the style, naming, and structure of existing code.
3. **Commit your work.** When you have completed all tasks, stage and commit your changes with a clear commit message describing what you built.
4. **Run validation commands** if they exist in \`.murder/config.ts\` — typecheck, lint, test. Fix any errors your changes introduce.
5. **Do NOT modify** \`.murder/\` files (other than your notes file above), \`progress.json\`, or any git configuration.
6. **Do NOT install new packages** unless explicitly required by your tasks. If you must install a package, note it clearly in your commit message.
`;
}

// ---------------------------------------------------------------------------
// EM Review Agent Prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the EM review agent that runs after the engineer
 * completes a phase. Responsible for validating the work, running tests,
 * and fixing any issues before advancing to the next phase.
 */
export function buildEmReviewPrompt(
  phase: Phase,
  slug: string,
  phaseNumber: number,
  projectContext: string
): string {
  const featureBranch = `murder/${slug}`;

  const workSummary = phase.engineer.sections
    .map((s) => `### ${s.name}\n${s.tasks.map((t) => `- ${t.description}`).join("\n")}`)
    .join("\n\n");

  return `# Murder EM Review Agent — Phase ${phaseNumber} Review

You are the Engineering Manager reviewing the engineer's work after Phase ${phaseNumber}: "${phase.name}".

The engineer has completed their assigned tasks on the feature branch \`${featureBranch}\`.

## What Was Built

${workSummary}

## Project Context

${projectContext}

## Your Tasks

1. **Run validation commands** from \`.murder/config.ts\` if present:
   - Typecheck
   - Lint
   - Test
   - Build

2. **Fix any issues** the engineer's changes introduced — broken imports, type errors, test failures, missing edge cases, etc.

3. **Commit any fixes** with a clear message like "Phase ${phaseNumber} review: fix [description]".

## Rules

- Do NOT refactor or improve code beyond what's needed to make things work.
- Do NOT start work on the next phase — only review and fix the current phase.
- Keep changes minimal and focused on making the code compile and pass tests.
`;
}
