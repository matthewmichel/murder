# Product Knowledge

## What This Project Is

murder is a local CLI tool that orchestrates AI coding agents to accomplish engineering tasks in codebases. The name references a "murder of crows" — a flock of agents working together. It targets individual developers working on personal or commercial projects who want to initiate background engineering processes steered by AI agents that can plan, implement, review, and document code changes autonomously.

The core value proposition: a developer describes what they want built in natural language, and murder runs a full engineering pipeline — product manager writes a PRD, engineering manager creates a phased plan, engineer agents implement each phase in an isolated git worktree, EM reviews each phase, and a post-mortem documents everything. The result is a pull request ready for human review.

murder also provides a knowledge layer (`murder init`, `murder learn`) that makes codebases legible to AI agents by generating structured documentation (AGENTS.md, ARCHITECTURE.md, PM.md, EM.md) that gets injected into every agent prompt.

## Core Product Concepts

- **Agent Backend**: An external AI coding CLI tool that murder dispatches work to. Currently only Cursor CLI is supported. The system is designed for multiple backends (the `agent_backends` table supports registration of any CLI agent).

- **Knowledge Files**: The `.murder/` directory in a project contains structured documentation files (ARCHITECTURE.md, core-beliefs.md, config.ts, PM.md, EM.md, FUTURE.md) plus the root-level AGENTS.md. These files are assembled into a "project context" block and injected into every agent prompt so agents understand the project before working on it.

- **Project Context**: The combined content of all knowledge files, formatted as a single string block by `src/lib/context.ts`. This is the primary mechanism for giving agents project awareness.

- **Dispatch**: The process of spawning an agent CLI process with a prompt. Prompts are written to temp files (to avoid shell argument length limits) and read via `$(cat 'path')`. The dispatch system tracks every task in the database with PID, status, log path, and timing.

- **Heartbeat / Stuck Detection**: A monitoring loop that watches dispatched agents by polling log file size. When an agent goes silent, it runs regex pattern matching against known failure modes (rate limits, auth failures, OOM). If patterns don't match, it falls back to AI-powered diagnosis, then human escalation.

- **Exec Plan**: The artifact produced by `murder new`. Lives in `.murder/exec-plans/active/<slug>/` and contains a PRD (prd.md), execution plan (plan.md), progress tracker (progress.json), and post-mortem artifacts (files.md, notes.md, metadata.json).

- **EM Loop**: The phased execution engine in `src/lib/em-loop.ts`. For each phase in the plan: dispatches an engineer agent → monitors → dispatches an EM review agent → monitors → advances to next phase. Progress is tracked via atomic JSON file writes.

- **Worktree Isolation**: All `murder new` engineering work happens in a git worktree at `.murder/worktrees/work/` on a `murder/<slug>` feature branch. The main working tree stays clean and unaffected.

- **Learn Mode**: A 6-phase interactive pipeline (`murder learn`) that builds project knowledge. PM agent explores the codebase → generates questions → user answers → PM synthesizes PM.md + FUTURE.md → EM agent explores → generates questions → user answers → EM synthesizes EM.md + updates FUTURE.md. Context is refreshed between phases so later agents see earlier outputs.

- **Preflight Check**: A quick smoke test (`src/lib/preflight.ts`) that runs the agent CLI with a trivial prompt before dispatching real work, to verify the agent is responsive and authenticated.

## User Flows

### First-Time Setup
1. Clone murder repo, `pnpm install`, symlink `bin/murder` to PATH
2. `murder start` — boots Docker Postgres, runs migrations, detects installed agent CLIs, starts web UI on port 1314
3. `murder setup` — interactive wizard to configure an AI provider (select provider → enter API key → select models for orchestration and embeddings)

### Initializing a Project
1. `cd` into the target project
2. `murder init` — scans the project (languages, frameworks, configs), registers it in the database, dispatches an agent to generate AGENTS.md and `.murder/` knowledge files

### Building Project Knowledge
1. `murder learn` — starts the 6-phase pipeline
2. PM agent explores the codebase and generates QUESTIONS.md
3. User opens QUESTIONS.md in their editor, answers questions, returns to CLI
4. PM agent synthesizes answers into PM.md and FUTURE.md
5. EM agent explores the codebase and generates engineering-focused QUESTIONS.md
6. User answers EM questions, returns to CLI
7. EM agent synthesizes into EM.md and updates FUTURE.md
8. QUESTIONS.md is cleaned up after each synthesis phase

### Executing a Task
1. `murder new "description of what to build"` — starts the full pipeline
2. Agent generates a git-friendly slug for the task
3. Creates a feature branch (`murder/<slug>`) and worktree
4. PM agent writes a PRD to the exec plan directory
5. EM agent reads the PRD and creates a phased execution plan + progress.json
6. EM loop runs: for each phase, engineer implements → EM reviews → advance
7. Post-mortem PM agent documents what was built (files.md, notes.md, metadata.json)
8. Worktree is cleaned up, branch is pushed, PR is created via `gh` CLI

### Monitoring
- `murder status` — shows active and recent agent tasks from the database
- Web UI at localhost:1314 — dashboard, providers, configs, agents, projects pages

### Shutdown
- `murder stop` — stops Docker containers and web UI
- `murder reset` — factory reset, destroys all data (volumes)

## Product Decisions & Rationale

**Agent-first architecture**: murder dispatches all coding work to external agent CLIs rather than calling AI APIs directly to generate code. This leverages the agent's built-in file editing, shell access, and context management capabilities. The Vercel AI SDK is currently used only for stuck detection diagnosis, but the direction is to remove direct model calling entirely.

**Local-only operation**: murder runs entirely on the developer's machine. No cloud deployment, no remote services (beyond AI provider APIs). The Postgres database runs in Docker locally. This keeps the tool simple, avoids auth/billing complexity, and keeps code on the developer's machine.

**Knowledge file injection over memory systems**: Rather than using vector embeddings or conversation memory, murder uses structured markdown files (AGENTS.md, ARCHITECTURE.md, PM.md, etc.) that are concatenated and injected directly into agent prompts. This is transparent, debuggable, and version-controllable.

**Git worktree isolation**: Agent work happens in a separate worktree so the developer's main working tree stays clean. This prevents agents from interfering with in-progress human work and makes cleanup straightforward.

**Prompt-as-file pattern**: Long prompts are written to temp files and read via `$(cat 'path')` to avoid shell argument length limits. This is a practical workaround for spawning CLI processes with large prompts.

**Conservative stuck detection**: The system strongly prefers "continue" over "kill" when an agent goes silent. Killing a working agent is considered worse than waiting. The three-tier approach (regex → AI diagnosis → human escalation) reflects this bias.

**Phased execution with review gates**: The EM loop breaks work into phases with mandatory EM review after each phase. This catches issues early rather than letting an agent build on a broken foundation for an entire task.

**GitHub-only PR creation**: PR creation uses the `gh` CLI. If `gh` isn't available, the branch is pushed and the user gets manual instructions. No GitLab, Bitbucket, or other forge support exists.

**Single agent per task**: The EM loop dispatches one engineer at a time per phase. There is no parallel agent execution.

## Business Rules

- A project must be registered in the database (`murder project` or `murder init`) before `murder new` or `murder learn` can be used.
- The `.murder/` directory must exist (created by `murder init`) for learn and new commands.
- Agent backends are detected by running `which` against known CLI commands. Currently only `cursor-cli` (the `agent` command) is detected.
- AI provider configs can be global (project_id IS NULL) or project-scoped. Project-scoped configs take priority over global defaults. Unique partial indexes enforce one active config per capability per scope.
- API keys are encrypted with AES-256-GCM using a master key stored at `~/.murder/secret.key`. The key is auto-generated on first use.
- Tasks in the database are marked as stuck by a pg_cron job if no output is detected for 5 minutes.
- The `murder new` pipeline requires a git repository. It warns about uncommitted changes but does not block execution.
- Feature branches follow the `murder/<slug>` naming pattern. Slugs are generated by the agent from the user's prompt, with a timestamp suffix for uniqueness.
- Output modes for agent dispatch: `inherit` (full TTY passthrough), `stream-json` (parsed NDJSON events with progress display), `pipe` (silent log capture). Learn and new commands use `stream-json`.
- The web UI runs as a detached background process spawned by `murder start`. It shares the same Postgres connection config as the CLI.

## Integrations & External Dependencies

- **Cursor CLI** (`agent` command): The only currently supported agent backend. Dispatched via `/bin/sh -c` with prompts passed as temp files. Supports `--model`, `-p` (prompt mode), `--force`, and `--output-format stream-json` flags.
- **Docker + Postgres 18**: The database runs in a Docker container on port 1313 with pgvector and pg_cron extensions. Managed via `docker compose`.
- **GitHub CLI (`gh`)**: Used for automated PR creation after `murder new` completes. Falls back to manual instructions if not available.
- **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`): Used for the stuck detection AI diagnosis feature in `src/lib/diagnosis.ts`. Supports Anthropic (direct) and OpenAI-compatible providers.
- **mem0ai + PGVectorStore**: Listed as dependencies and wired up (`src/lib/pgvector.ts`) but not actively used in any command flow. Slated for removal.
- **@modelcontextprotocol/sdk**: In dependencies but the `src/mcp/` directory is unused. Was explored as an alternative to git worktrees for agent isolation but abandoned in favor of the worktree approach. Slated for removal.

## Current Limitations

- Only Cursor CLI is supported as an agent backend. No Claude Code or Codex CLI support.
- No test suite, linter, or CI pipeline exists.
- The web UI is read-only for management viewing. It cannot update or manage configuration settings.
- No scheduling or templating system for recurring tasks. Each `murder new` invocation is a one-off.
- No `murder edit` command for making lightweight tweaks to an existing PR after it's been created.
- The `step()`, `ok()`, `fail()`, and `divider()` CLI output helpers are duplicated across every command file instead of being in a shared utility module.
- The custom interactive prompt system (`src/lib/prompt.ts`) is hand-rolled from raw stdin rather than using an established library.
- The `conversations` and `conversation_messages` database tables are unused. The task-based model has fully superseded them.
- The `mem0ai` dependency and `PGVectorStore` are wired up but not used in any command flow.
- The `@modelcontextprotocol/sdk` dependency and `src/mcp/` directory are unused.
- `murder learn` is not resumable mid-pipeline — if you cancel partway through, you restart from the beginning.
- Stuck detection timeout thresholds (30s default, 120s for learn/new, 300s for engineer phases) are arbitrary and not tuned to observed agent behavior.
- AI-powered stuck diagnosis calls the Vercel AI SDK directly, which contradicts the agent-first direction.
