// ---------------------------------------------------------------------------
// Prompt builders for the murder agent pipelines.
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

## Getting Oriented

**Start by reading \`AGENTS.md\` at the project root.** This is the project's map — it describes the tech stack, directory structure, key conventions, and how to validate changes. Use it to ground your understanding before writing the PRD.

## The Feature Request

${userRequest}

## Project Context

The following is a directory of knowledge files available in this project. Use your file-reading tools to read any files relevant to your task.

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

## Getting Oriented

**Start by reading \`AGENTS.md\` at the project root.** This is the project's map — it describes the tech stack, directory structure, validation commands, and key conventions. Use it to understand how the project is set up before creating your plan.

## Your Inputs

1. **Read the PRD** at this path: \`${prdPath}\`
2. **Project context** is provided below.
3. **Read the actual source code** as needed to understand the codebase structure.

## Project Context

The following is a directory of knowledge files available in this project. Use your file-reading tools to read any files relevant to your task.

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

The following is a directory of knowledge files available in this project. Use your file-reading tools to read any files relevant to your task.

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

The following is a directory of knowledge files available in this project. Use your file-reading tools to read any files relevant to your task.

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

// ---------------------------------------------------------------------------
// Post-Mortem PM Agent Prompt
// ---------------------------------------------------------------------------

export interface PostMortemMeta {
  slug: string;
  branch: string;
  agentName: string;
  startedAt: string;
  completedAt: string;
  totalElapsedMs: number;
  phasesCompleted: number;
  totalPhases: number;
  status: "completed" | "failed";
}

/**
 * Build the prompt for the post-mortem PM agent that runs after the
 * engineering loop finishes. Produces three deliverables:
 *   - files.md   — list of changed files with descriptions
 *   - notes.md   — post-mortem analysis
 *   - metadata.json — structured timing/usage metadata
 */
export function buildPostMortemPmPrompt(
  progressContent: string,
  planContent: string,
  prdContent: string,
  projectContext: string,
  meta: PostMortemMeta,
  filesOutputPath: string,
  notesOutputPath: string,
  metadataOutputPath: string
): string {
  return `# Murder Post-Mortem PM Agent

You are acting as a senior Product Manager conducting a post-mortem review of a completed engineering task. The engineering team has finished implementing a feature and you need to document what was built.

## What Happened

- **Task slug**: ${meta.slug}
- **Branch**: ${meta.branch}
- **Agent**: ${meta.agentName}
- **Status**: ${meta.status}
- **Started**: ${meta.startedAt}
- **Completed**: ${meta.completedAt}
- **Duration**: ${Math.round(meta.totalElapsedMs / 1000)}s
- **Phases**: ${meta.phasesCompleted}/${meta.totalPhases} completed

## The Original PRD

${prdContent}

## The Execution Plan

${planContent}

## The Progress Tracker

\`\`\`json
${progressContent}
\`\`\`

## Project Context

The following is a directory of knowledge files available in this project. Use your file-reading tools to read any files relevant to your task.

${projectContext}

## Your Task — THREE files to create

You MUST investigate what was actually built by running:
- \`git log main...HEAD --oneline\` to see the commits
- \`git diff main...HEAD --stat\` to see which files changed
- \`git diff main...HEAD\` to see the actual changes (skim large diffs)

Then create exactly three files:

### File 1: Changed Files — \`${filesOutputPath}\`

A markdown document listing every file that was changed, with a brief description of what changed in each file. Group by directory if helpful.

\`\`\`markdown
# Changed Files

## path/to/file.ts
Brief description of what changed and why.

## path/to/another-file.ts
Brief description of what changed and why.
\`\`\`

### File 2: Post-Mortem Notes — \`${notesOutputPath}\`

A markdown document covering:

\`\`\`markdown
# Post-Mortem: ${meta.slug}

## Summary
2-3 sentences on what was implemented.

## Implementation Notes
How it was built — key patterns, libraries, approaches used. Reference specific files.

## Impact on Project
How this change affects the broader codebase. What other systems or workflows are impacted? Are there any new conventions or patterns introduced?

## Notable Decisions
Any tradeoffs, workarounds, or architectural choices worth calling out.
\`\`\`

### File 3: Metadata — \`${metadataOutputPath}\`

A JSON file with structured metadata. Use this exact schema:

\`\`\`json
{
  "slug": "${meta.slug}",
  "branch": "${meta.branch}",
  "agent": "${meta.agentName}",
  "status": "${meta.status}",
  "startedAt": "${meta.startedAt}",
  "completedAt": "${meta.completedAt}",
  "durationMs": ${meta.totalElapsedMs},
  "phases": {
    "total": ${meta.totalPhases},
    "completed": ${meta.phasesCompleted}
  }
}
\`\`\`

## Rules

- Ground everything in the actual git diff — don't guess what changed, look at it.
- Be specific. Reference real files, real functions, real patterns.
- Keep files.md factual and concise — one file per entry, brief description.
- Keep notes.md insightful — focus on impact and decisions, not just a list of changes.
- The metadata.json values above are pre-filled — use them as-is.
- You MUST create exactly THREE files at the paths specified above.
- Do NOT create any other files.
- Do NOT modify any existing files.
`;
}

// ---------------------------------------------------------------------------
// Learn Mode — PM Exploration Prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the PM agent in learn mode (exploration phase).
 * The agent explores the codebase and existing docs, then writes a
 * QUESTIONS.md file for the user to answer.
 */
export function buildPmExplorePrompt(
  projectContext: string,
  questionsOutputPath: string
): string {
  return `# Murder PM Agent — Learn Mode (Exploration)

You are acting as a senior Product Manager conducting a deep-dive into a codebase you need to understand. Your goal is to explore the project thoroughly and generate a set of insightful questions that will help you build a comprehensive product-level understanding of this project.

## Getting Oriented

**Start by reading \`AGENTS.md\` at the project root.** Then read the \`.murder/\` directory for any existing architecture docs, core beliefs, and config files. These give you the current state of documented knowledge.

## Project Context

${projectContext}

## Your Task

1. **Explore the entire codebase.** Read the directory structure, key source files, configuration files, package manifests, and any existing documentation. Understand what this project does, who it's for, and how it's organized.

2. **Identify knowledge gaps.** Compare what's documented in the existing context files against what you discover in the actual code. Look for:
   - Product decisions that aren't documented (why does feature X work this way?)
   - User flows and workflows that aren't explained
   - Business logic that's embedded in code but not captured in docs
   - Architectural rationale that's missing (why this tech stack? why this structure?)
   - Domain concepts and terminology that need clarification
   - Integration points, external dependencies, and their purposes
   - Configuration and environment setup that isn't documented

3. **Write a QUESTIONS.md file** to this exact path:

\`${questionsOutputPath}\`

The file should follow this format:

\`\`\`markdown
# Product Manager Questions

> These questions were generated by analyzing the codebase. Please answer each question
> by editing this file directly. Write your answers below each question. Be as detailed
> as you find useful — the more context you provide, the better the resulting knowledge
> base will be.

## Product & Purpose
1. [Question about the product's purpose, target users, or business context]

   **Answer:**

2. [Another question]

   **Answer:**

## User Flows & Features
3. [Question about how users interact with the product]

   **Answer:**

## Business Logic & Decisions
4. [Question about why something works a certain way]

   **Answer:**

## Architecture & Design Rationale
5. [Question about architectural choices]

   **Answer:**

## Integrations & Dependencies
6. [Question about external services, APIs, or dependencies]

   **Answer:**

## Future Direction
7. [Question about planned features, known limitations, or roadmap]

   **Answer:**
\`\`\`

## Rules

- Ask 10-20 questions. Quality over quantity — each question should seek genuinely useful knowledge that would help future AI agents make better decisions.
- Group questions by theme using the section headers above (add or remove sections as needed).
- Focus on the "why" behind decisions, not the "what" (the code already tells us what exists).
- Don't ask questions that can be fully answered by reading the code — ask about intent, context, and decisions that only a human would know.
- You MUST create exactly one file at the path specified above.
- Do NOT create any other files.
- Do NOT modify any existing files.
`;
}

// ---------------------------------------------------------------------------
// Learn Mode — PM Synthesis Prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the PM agent in learn mode (synthesis phase).
 * The agent reads the user's answers in QUESTIONS.md, explores the codebase,
 * and produces PM.md plus updates to existing knowledge files.
 */
export function buildPmSynthesizePrompt(
  projectContext: string,
  questionsPath: string,
  pmOutputPath: string,
  futureOutputPath: string
): string {
  return `# Murder PM Agent — Learn Mode (Synthesis)

You are acting as a senior Product Manager synthesizing knowledge about a project. The user has answered a set of questions about their project, and your job is to combine those answers with your own analysis of the codebase into comprehensive knowledge documents.

## Getting Oriented

**Start by reading \`AGENTS.md\` at the project root.** Then read the existing \`.murder/\` docs to understand what's already documented.

## Your Inputs

1. **Read the answered questions** at: \`${questionsPath}\`
2. **Project context** is provided below.
3. **Explore the actual source code** to validate and supplement the user's answers.

## Project Context

${projectContext}

## Your Task — Create PM.md, FUTURE.md, and update existing docs

### CRITICAL: Separate current state from future direction

You MUST keep a strict separation between:
- **Current state** (how things work TODAY) → goes in PM.md
- **Future plans, roadmap, planned features, and aspirational improvements** → goes in FUTURE.md

PM.md must ONLY describe the project as it exists right now. No "planned", "to be added", "should be", "will be", or "near-term priority" language. If something doesn't exist yet, it does NOT belong in PM.md.

### Primary output 1: PM.md — \`${pmOutputPath}\`

Create a product knowledge document that captures the CURRENT STATE of the project — everything an AI agent needs to know to make good product decisions. Structure it like this:

\`\`\`markdown
# Product Knowledge

## What This Project Is
A clear, concise description of the project — what it does, who it's for, and why it exists.

## Core Product Concepts
Key domain concepts, terminology, and mental models needed to understand the product. Define terms that someone new to the project would need to know.

## User Flows
The primary ways users interact with the product. Describe the key workflows end-to-end.

## Product Decisions & Rationale
Important product decisions that have been made and why. This helps future agents understand the reasoning behind the current state of things.

## Business Rules
Any business logic, constraints, or rules that govern how the product behaves. These are the things that might not be obvious from reading code alone.

## Integrations & External Dependencies
External services, APIs, and tools the project depends on. What they're used for and why they were chosen.

## Current Limitations
Things the product cannot do today. State them factually without prescribing solutions.
\`\`\`

### Primary output 2: FUTURE.md — \`${futureOutputPath}\`

Create a future direction document that captures all planned work, aspirational improvements, and roadmap items. Structure it like this:

\`\`\`markdown
# Future Direction

## Near-Term Priorities
Specific tasks and improvements that are the immediate next focus.

## Planned Features
Features that are planned but not yet implemented. Include context on why they matter.

## Long-Term Vision
The broader direction the project is heading. Big-picture aspirations.

## Ideas & Possibilities
Things that came up in discussion that aren't committed to but are worth tracking.
\`\`\`

### Secondary task: Update existing knowledge files

After creating PM.md and FUTURE.md, review the existing knowledge files and update them if you learned new information:

- **\`AGENTS.md\`** (project root) — Update if you discovered new commands, directory structure changes, conventions, or validation workflows not currently documented.
- **\`.murder/ARCHITECTURE.md\`** — Update if you learned about architectural patterns, data flows, or system design details not currently captured.
- **\`.murder/core-beliefs.md\`** — Update if you identified new coding conventions, style preferences, or principles the project follows.

Only update these files if you have genuinely new, accurate information to add. Don't rewrite them — append or refine sections as needed.

## Rules

- Ground everything in the actual codebase and the user's answers. Don't fabricate information.
- Be specific. Reference real files, real patterns, real decisions.
- Write for an AI agent audience — focus on information that helps with decision-making.
- Keep it concise but thorough. Every section should earn its place.
- **PM.md is ONLY current state.** No future plans, no "should be", no "planned", no roadmap items.
- **FUTURE.md is ONLY forward-looking.** Planned features, improvements, roadmap, and aspirational goals.
- You MUST create both PM.md and FUTURE.md at the paths specified above.
- You MAY update AGENTS.md, ARCHITECTURE.md, and core-beliefs.md if warranted.
- Do NOT create any files other than PM.md and FUTURE.md.
`;
}

// ---------------------------------------------------------------------------
// Learn Mode — EM Exploration Prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the EM agent in learn mode (exploration phase).
 * The agent explores the codebase from an engineering perspective and writes
 * a QUESTIONS.md file focused on technical concerns.
 */
export function buildEmExplorePrompt(
  projectContext: string,
  questionsOutputPath: string
): string {
  return `# Murder EM Agent — Learn Mode (Exploration)

You are acting as a senior Engineering Manager conducting a technical deep-dive into a codebase. Your goal is to explore the project thoroughly from an engineering perspective and generate questions that will help you build a comprehensive technical understanding.

## Getting Oriented

**Start by reading \`AGENTS.md\` at the project root.** Then read the \`.murder/\` directory for existing architecture docs, core beliefs, and any PM.md that may have been created. These give you the current state of documented knowledge.

## Project Context

${projectContext}

## Your Task

1. **Explore the entire codebase from an engineering perspective.** Read source files, configuration, build setup, dependency manifests, test files, CI/CD config, and infrastructure setup. Focus on understanding the technical implementation.

2. **Identify technical knowledge gaps.** Look for:
   - Code patterns and conventions that aren't documented (error handling, logging, etc.)
   - Testing strategy and what's covered vs. what isn't
   - Build, deployment, and CI/CD setup
   - Performance characteristics and optimization approaches
   - Security patterns and concerns
   - Technical debt and areas that need refactoring
   - Database schema design decisions
   - API design patterns and versioning
   - Dependency choices and their rationale
   - Environment configuration and secrets management
   - Monitoring, logging, and observability

3. **Write a QUESTIONS.md file** to this exact path:

\`${questionsOutputPath}\`

The file should follow this format:

\`\`\`markdown
# Engineering Manager Questions

> These questions were generated by analyzing the codebase from a technical perspective.
> Please answer each question by editing this file directly. Write your answers below each
> question. The more context you provide, the better.

## Code Patterns & Conventions
1. [Question about coding patterns, style decisions, or conventions]

   **Answer:**

2. [Another question]

   **Answer:**

## Testing & Quality
3. [Question about testing strategy, coverage, or quality processes]

   **Answer:**

## Build, Deploy & Infrastructure
4. [Question about build pipeline, deployment, or infrastructure]

   **Answer:**

## Performance & Scaling
5. [Question about performance requirements or scaling approach]

   **Answer:**

## Security & Data
6. [Question about security practices or data handling]

   **Answer:**

## Technical Debt & Improvements
7. [Question about known tech debt or planned improvements]

   **Answer:**

## Development Workflow
8. [Question about how the team works, PR process, etc.]

   **Answer:**
\`\`\`

## Rules

- Ask 10-20 questions. Focus on engineering-specific concerns that complement (don't duplicate) the product-level knowledge already captured.
- Group questions by theme using the section headers above (add or remove sections as needed).
- Focus on the "why" and "how" of technical decisions — not things you can determine by reading code.
- Ask about operational concerns: how is this deployed? how is it monitored? what breaks?
- You MUST create exactly one file at the path specified above.
- Do NOT create any other files.
- Do NOT modify any existing files.
`;
}

// ---------------------------------------------------------------------------
// Learn Mode — EM Synthesis Prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the EM agent in learn mode (synthesis phase).
 * The agent reads the user's answers in QUESTIONS.md, explores the codebase,
 * and produces EM.md plus updates to existing knowledge files.
 */
export function buildEmSynthesizePrompt(
  projectContext: string,
  questionsPath: string,
  emOutputPath: string,
  futureOutputPath: string
): string {
  return `# Murder EM Agent — Learn Mode (Synthesis)

You are acting as a senior Engineering Manager synthesizing technical knowledge about a project. The user has answered a set of engineering-focused questions, and your job is to combine those answers with your own analysis of the codebase into comprehensive knowledge documents.

## Getting Oriented

**Start by reading \`AGENTS.md\` at the project root.** Then read the existing \`.murder/\` docs to understand what's already documented.

## Your Inputs

1. **Read the answered questions** at: \`${questionsPath}\`
2. **Project context** is provided below.
3. **Explore the actual source code** to validate and supplement the user's answers.

## Project Context

${projectContext}

## Your Task — Create EM.md, update FUTURE.md, and update existing docs

### CRITICAL: Separate current state from future direction

You MUST keep a strict separation between:
- **Current state** (how things work TODAY, what code exists NOW) → goes in EM.md
- **Future plans, tech debt improvements, planned refactoring, aspirational changes** → goes in FUTURE.md

EM.md must ONLY describe the engineering reality as it exists right now. No "planned", "to be added", "should be", "will be", or "near-term priority" language. If something doesn't exist yet, it does NOT belong in EM.md.

### Primary output 1: EM.md — \`${emOutputPath}\`

Create an engineering knowledge document that captures the CURRENT STATE of the codebase — everything an AI coding agent needs to know to write good code in this project. Structure it like this:

\`\`\`markdown
# Engineering Knowledge

## Technical Architecture Overview
A concise but thorough description of how the system is built — key components, data flow, and how they connect.

## Code Patterns & Conventions
The patterns that code in this project should follow. Error handling, logging, naming conventions, file organization, import style, etc. Be specific enough that an AI agent can match the existing style.

## Testing Strategy
How testing works in this project today — what's tested, what frameworks are used, how to run tests.

## Build & Deployment
How the project is built, deployed, and released today. CI/CD setup, environment configuration, and any deployment gotchas.

## Database & Data Layer
How data is stored, accessed, and managed. Schema design principles, migration strategy, query patterns.

## API & Integration Patterns
How external APIs are called, how internal APIs are structured, authentication patterns, error handling for integrations.

## Performance Considerations
Known performance characteristics and current optimization approaches.

## Security Practices
Security patterns currently in use, how secrets are managed, authentication/authorization approach, data protection.

## Technical Debt & Known Issues
Current tech debt and known bugs. State them factually — do NOT prescribe solutions or improvements here. Just describe what exists and what's broken.

## Development Workflow
How development happens today — branching strategy, PR process, code review expectations, tooling.
\`\`\`

### Primary output 2: Update FUTURE.md — \`${futureOutputPath}\`

A FUTURE.md file already exists from the PM synthesis phase. **Read it first**, then add any engineering-specific future items you learned from the user's answers. Append an engineering section to the existing content:

\`\`\`markdown
## Engineering Improvements
Technical improvements, refactoring plans, testing goals, infrastructure upgrades, and other engineering-specific future work. Include context on why each item matters.
\`\`\`

If the existing FUTURE.md already covers some of what you'd add, update those sections rather than duplicating. Preserve the existing content — add to it, don't replace it.

### Secondary task: Update existing knowledge files

After creating EM.md and updating FUTURE.md, review the existing knowledge files and update them if you learned new technical information:

- **\`AGENTS.md\`** (project root) — Update if you discovered new validation commands, build steps, directory structure changes, or conventions not currently documented.
- **\`.murder/ARCHITECTURE.md\`** — Update if you learned about system architecture, data flows, component interactions, or infrastructure details not currently captured.
- **\`.murder/core-beliefs.md\`** — Update if you identified new coding conventions, engineering principles, or style preferences the project follows.

Only update these files if you have genuinely new, accurate information to add. Don't rewrite them — append or refine sections as needed.

## Rules

- Ground everything in the actual codebase and the user's answers. Don't fabricate information.
- Be specific. Reference real files, real functions, real patterns.
- Write for an AI coding agent audience — focus on information that helps write correct, idiomatic code.
- Keep it concise but thorough. Every section should earn its place.
- **EM.md is ONLY current state.** No future plans, no "should be", no "planned", no roadmap items.
- **FUTURE.md is ONLY forward-looking.** Add engineering improvements to the existing file.
- You MUST create the EM.md file at the path specified above.
- You MUST update the FUTURE.md file at the path specified above (read it first, then add to it).
- You MAY update AGENTS.md, ARCHITECTURE.md, and core-beliefs.md if warranted.
- Do NOT create any files other than EM.md.
`;
}
