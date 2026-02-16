# Architecture — murder

## System Overview

murder is a CLI tool that makes codebases legible to AI coding agents and orchestrates their work. It runs entirely locally — a Dockerized Postgres 18 database serves as the central brain, and a React Router web UI provides management. The CLI dispatches work to agent backends (currently Cursor CLI) and monitors them with heartbeat-based stuck detection.

### Core Data Flow

```
User runs command
       │
       ▼
src/index.ts (CLI router)
       │
       ▼
src/commands/*.ts (command handler)
       │
       ├──► src/lib/db.ts ──► Postgres (port 1313)
       ├──► src/lib/ai.ts ──► AI provider APIs (Anthropic, OpenAI, etc.)
       ├──► src/lib/dispatch.ts ──► Agent CLI process (Cursor CLI)
       │         │
       │         ▼
       │    src/lib/heartbeat.ts (monitor loop)
       │         │
       │         ├──► src/lib/patterns.ts (regex stuck detection)
       │         └──► src/lib/diagnosis.ts (AI-powered stuck diagnosis)
       │
       └──► src/lib/context.ts ──► .murder/ files in user's project
```

### `murder new` Pipeline (most complex flow)

```
murder new "<prompt>"
       │
       ▼
1. PM Agent ──► writes PRD to .murder/exec-plans/active/<slug>/prd.md
       │
       ▼
2. EM Agent ──► writes plan.md + progress.json (phased execution plan)
       │
       ▼
3. EM Loop (src/lib/em-loop.ts):
   For each phase:
     a. Engineer Agent ──► implements tasks in git worktree
     b. EM Review Agent ──► validates, runs checks, fixes issues
       │
       ▼
4. Post-mortem PM Agent ──► writes files.md, notes.md, metadata.json
       │
       ▼
5. Cleanup ──► remove worktree, push branch, create PR via `gh`
```

All agent work happens in an isolated git worktree (`.murder/worktrees/work/`) on a `murder/<slug>` feature branch. The main working tree stays clean.

## Key Modules

### Commands (`src/commands/`)

| File | Purpose |
|------|---------|
| `start.ts` | Boots Docker, runs migrations, detects agents, starts web UI |
| `setup.ts` | Interactive AI provider configuration (API keys, model selection) |
| `init.ts` | Scans project, dispatches agent to generate knowledge files |
| `new.ts` | Full PM → EM → Engineer pipeline with worktree isolation |
| `status.ts` | Queries tasks table, displays active/recent tasks |
| `stop.ts` | `docker compose down` + kills web UI process |
| `reset.ts` | `docker compose down -v` (destroys volumes) |
| `project.ts` | Register/view project in database |

### Core Library (`src/lib/`)

**AI & Providers:**
- `ai.ts` — Resolves active AI config from DB, creates language/embedding models via Vercel AI SDK. Supports Anthropic (direct) and OpenAI-compatible providers (OpenAI, OpenRouter, Vercel AI Gateway, Voyage). Provider instances are cached by `slug:keyAlias`.
- `providers.ts` — CRUD for AI providers, encrypted API key storage, config upserts.
- `crypto.ts` — AES-256-GCM encryption. Master key stored at `~/.murder/secret.key` (auto-generated on first use).

**Agent Dispatch & Monitoring:**
- `agents.ts` — Detects installed agent CLIs via `which`, registers in DB. Currently only Cursor CLI (`agent` command).
- `dispatch.ts` — Spawns agent process via `/bin/sh -c`, writes prompt to temp file (avoids arg length limits). Three output modes: `inherit` (full TTY), `stream-json` (parsed NDJSON events), `pipe` (silent log capture). Records task in DB.
- `heartbeat.ts` — Monitors running agent by polling log file size. Detects silence (no output), runs pattern matching then AI diagnosis. Actions: continue, kill, retry, escalate.
- `patterns.ts` — Regex patterns for known stuck states (rate limits, auth failures, OOM, etc.). Agent-specific patterns (Cursor CLI auth, invalid model).
- `diagnosis.ts` — Sends recent agent output to orchestration model for verdict. Conservative — prefers "continue" over killing a working agent.
- `preflight.ts` — Quick smoke test before dispatch: runs agent with a trivial prompt to verify it's responsive and authenticated.

**Execution Pipeline:**
- `prompts.ts` — Prompt builders for each agent role: PM (PRD generation), EM (execution planning), Engineer (phase implementation), EM Review (validation), Post-mortem PM (documentation).
- `em-loop.ts` — Drives the phased execution loop. For each phase: dispatch engineer → monitor → dispatch EM review → monitor → advance. Tracks progress via `progress.json`.
- `progress.ts` — Typed read/write/mutation for `progress.json`. Atomic writes via temp file + rename.
- `context.ts` — Reads `.murder/` knowledge files (ARCHITECTURE.md, core-beliefs.md, config.ts, AGENTS.md) and formats them for prompt injection.

**Project Analysis:**
- `scanner.ts` — Scans a project directory: detects languages, frameworks, package manager, test runner, linter, formatter, CI, Docker. Builds directory tree (max depth 3, ignores node_modules/.git/etc).

**Infrastructure:**
- `db.ts` — Single `postgres.js` connection to `localhost:1313` (configurable via env vars).
- `migrate.ts` — Runs SQL migrations from `docker/postgres/migrations/`. Tracks applied migrations in `schema_migrations` table. Handles first-run detection (Docker entrypoint may have already applied migrations).
- `pgvector.ts` — Custom `PGVectorStore` class implementing mem0's VectorStore interface using `postgres.js` instead of `pg`. Supports HNSW indexing.
- `worktree.ts` — Git worktree management: create feature branch, set up worktree, cleanup, create PR via `gh` CLI.
- `prompt.ts` — Zero-dependency interactive CLI prompts using raw stdin. Single-select, multi-select, text input, secret input, yes/no confirm.
- `models.ts` — Cursor CLI model constants (Claude, GPT, Composer variants).

### Web UI (`web/`)

React Router v7 app with Tailwind CSS v4 + DaisyUI v5. Runs on port 1314 (configurable via `MURDER_UI_PORT`). Spawned as a detached background process by `murder start`.

**Routes:** Dashboard (`/`), Providers (`/providers`), Models (`/configs`), Agents (`/agents`), Projects (`/projects`).

**Server-side:** `web/app/lib/db.server.ts` mirrors `src/lib/db.ts` (same connection config). `web/app/lib/crypto.server.ts` mirrors `src/lib/crypto.ts`.

## Dependency Graph

```
src/index.ts
  └── src/commands/*
        ├── src/lib/db.ts ─────────────────────────────► postgres (npm)
        ├── src/lib/ai.ts ─────────────────────────────► @ai-sdk/openai, @ai-sdk/anthropic, ai
        │     └── src/lib/crypto.ts ───────────────────► node:crypto
        │     └── src/lib/db.ts
        ├── src/lib/dispatch.ts ───────────────────────► node:child_process, node:fs
        │     └── src/lib/db.ts
        ├── src/lib/heartbeat.ts
        │     ├── src/lib/dispatch.ts
        │     ├── src/lib/patterns.ts
        │     └── src/lib/diagnosis.ts
        │           └── src/lib/ai.ts
        ├── src/lib/agents.ts ─────────────────────────► node:child_process
        │     ├── src/lib/db.ts
        │     ├── src/lib/models.ts
        │     └── src/lib/prompt.ts
        ├── src/lib/context.ts ────────────────────────► node:fs
        ├── src/lib/prompts.ts
        │     └── src/lib/progress.ts
        ├── src/lib/em-loop.ts
        │     ├── src/lib/dispatch.ts
        │     ├── src/lib/heartbeat.ts
        │     ├── src/lib/progress.ts
        │     └── src/lib/prompts.ts
        ├── src/lib/worktree.ts ───────────────────────► node:child_process
        ├── src/lib/scanner.ts ────────────────────────► node:fs
        ├── src/lib/providers.ts
        │     ├── src/lib/db.ts
        │     └── src/lib/crypto.ts
        ├── src/lib/preflight.ts ──────────────────────► node:child_process
        ├── src/lib/migrate.ts ────────────────────────► node:child_process (docker compose exec)
        ├── src/lib/pgvector.ts ───────────────────────► postgres (npm)
        └── src/lib/prompt.ts ─────────────────────────► node:process (raw stdin)
```

## Database Schema

Postgres 18 running in Docker on port 1313. Migrations in `docker/postgres/migrations/`.

### Extensions
- `vector` (pgvector) — embedding storage and similarity search
- `pg_cron` — scheduled background jobs

### Tables

**`projects`** — Registered codebases
- `id` UUID PK, `name`, `slug` (unique), `description`, `root_path`, `metadata` JSONB

**`ai_providers`** — Seeded provider registry (OpenAI, Anthropic, OpenRouter, Vercel AI Gateway, Voyage)
- `id` UUID PK, `slug` (unique), `name`, `provider_type` (direct|gateway), `base_url`, `supported_capabilities` TEXT[], `default_models` JSONB

**`ai_provider_keys`** — Encrypted API keys (one per provider)
- `id` UUID PK, `provider_id` FK → ai_providers, `encrypted_api_key`, `key_alias`, `is_active`

**`ai_configs`** — Active model configuration per capability, optionally project-scoped
- `id` UUID PK, `project_id` FK → projects (NULL = global), `provider_key_id` FK → ai_provider_keys, `capability` (embeddings|orchestration), `model_name`, `is_active`
- Unique partial indexes enforce one config per capability per project and one global default per capability

**`conversations`** — Agent session tracking
- `id` UUID PK, `project_id` FK, `title`, `summary`, `status` (active|completed|archived), `message_count`

**`conversation_messages`** — Individual messages within conversations
- `id` UUID PK, `conversation_id` FK, `role` (user|assistant|system|tool), `content`, `token_count`, `model_used`

**`agent_backends`** — Detected agent CLI tools
- `id` UUID PK, `slug` (unique), `name`, `cli_command`, `cli_path`, `version`, `is_available`, `is_default`, `preferred_model`

**`tasks`** — Dispatched agent work (tracked by heartbeat)
- `id` UUID PK, `project_id` FK, `agent_slug`, `command_name`, `prompt`, `pid`, `status` (running|completed|failed|stuck|killed), `log_path`, `exit_code`, `ai_diagnosis`, `output_bytes`, `last_output_at`, `started_at`, `completed_at`
- pg_cron job marks tasks as stuck if no output for 5 minutes

**`memory_migrations`** — mem0 internal user ID tracking
- `id` SERIAL PK, `user_id` TEXT (unique)

**`mem0_memories`** — Created at runtime by PGVectorStore (vector dimension depends on embedding model)
- `id` UUID PK, `vector` vector(N), `payload` JSONB (scoped by `payload->>'userId'`)

**`schema_migrations`** — Migration tracking (created by `src/lib/migrate.ts`)
- `filename` TEXT PK, `applied_at` TIMESTAMPTZ

### Shared Trigger
All tables with `updated_at` use `set_updated_at()` trigger function (defined in `002_projects.sql`).

## Build & Deploy

murder runs entirely locally. There is no deploy pipeline.

- **CLI:** `bin/murder` shell script → `tsx src/index.ts` (no build step, runs TypeScript directly)
- **Database:** `docker compose up -d --build` from project root
- **Web UI:** `npx react-router dev --port 1314` (spawned by `murder start`)
- **Installation:** Clone repo, `pnpm install`, symlink `bin/murder` to `/usr/local/bin/murder`

## Known Patterns

**Error handling:** Try/catch at command boundaries with user-friendly console messages. Fatal errors call `process.exit(1)`. Non-critical DB update failures are silently caught (e.g., task output tracking).

**State management:** Database is the source of truth for providers, agents, tasks, and projects. The `.murder/` directory in user projects is the source of truth for project knowledge (AGENTS.md, ARCHITECTURE.md, core-beliefs.md, config.ts). Progress tracking during `murder new` uses atomic JSON file writes.

**Agent monitoring:** Three-tier stuck detection: (1) regex pattern matching (cheap), (2) AI diagnosis via orchestration model (expensive, run once per silence window), (3) escalation to human after extended silence.

**Output modes:** Agent dispatch supports three modes — `inherit` (full TTY passthrough), `stream-json` (parsed NDJSON events with progress display), `pipe` (silent log capture for background tasks).

**Prompt architecture:** Each agent role (PM, EM, Engineer, Review) gets a structured prompt with project context injected. Prompts instruct agents to read `AGENTS.md` first, then work within the project's conventions.
