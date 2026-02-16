# Engineering Knowledge

## Technical Architecture Overview

murder is a TypeScript CLI tool (ES2022, ESM) that runs via `tsx` with no build step. It orchestrates AI coding agents by spawning external CLI processes (currently Cursor CLI), monitoring them via log-file-based heartbeat detection, and tracking everything in a local Postgres 18 database running in Docker on port 1313.

The system has three main surfaces:

1. **CLI** (`src/index.ts` → `src/commands/*.ts`) — the primary interface. Commands are plain async functions routed by a simple if/else chain on `process.argv[2]`. No CLI framework is used.
2. **Database** (Postgres via `postgres.js`) — stores providers, API keys, agent backends, tasks, and projects. Accessed via raw SQL tagged template literals.
3. **Web UI** (`web/`) — React Router v7 app on port 1314, spawned as a detached background process by `murder start`. Currently read-only.

The core dispatch flow: command handler → `dispatchAgent()` spawns a `/bin/sh -c` process running the agent CLI → `monitorTask()` polls the log file for output → stuck detection (regex patterns → AI diagnosis → human escalation) → task completion recorded in DB.

Project context flows through `.murder/` knowledge files (AGENTS.md, ARCHITECTURE.md, core-beliefs.md, config.ts, PM.md, EM.md, FUTURE.md). `assembleProjectContext()` in `src/lib/context.ts` reads all files synchronously via `readFileSync` and `formatContextForPrompt()` concatenates them into a single string block that gets injected verbatim into agent prompts. **Note:** This injects full file contents into every prompt, which is a known issue — the intent is to instead bake knowledge of file locations into prompts so agents can retrieve context on demand.

## Code Patterns & Conventions

### Module System
- ESM only. `"type": "module"` in package.json, `"module": "ES2022"` in tsconfig.
- All imports use `.js` extensions even for `.ts` files: `import { x } from "./foo.js"`.
- `"moduleResolution": "bundler"` in tsconfig.
- No barrel files — import directly from the specific module.
- Type-only imports use `import type { X }`.
- Node built-ins in CLI code use bare specifiers (`"fs"`, `"path"`, `"crypto"`); web code uses `node:` prefix.

### File Organization
- One command per file in `src/commands/`, each exporting a single async function.
- Library modules in `src/lib/`, each with a focused responsibility.
- Types defined inline at the top of the file that uses them, not in separate type files.
- Section separators: `// ---------------------------------------------------------------------------` comment blocks to visually separate Types, Helpers, Public API sections within files.

### CLI Output
- Console output uses `step()`, `ok()`, `fail()`, `divider()`, and `formatDuration()` helper functions.
- `step()` prints `  ● message`, `ok()` prints `  ✓ message\n`, `fail()` prints `  ✗ message`.
- `divider()` prints a line of `─` characters.
- These helpers are currently copy-pasted across `src/commands/learn.ts`, `src/commands/new.ts`, `src/lib/em-loop.ts`, and `src/lib/heartbeat.ts`. They are not in a shared module.

### Error Handling
- Try/catch at command boundaries. Each command handler wraps its logic in try/catch.
- User-friendly error messages — no raw stack traces exposed. Print a clear message and suggest next steps.
- `process.exit(1)` for fatal errors after printing the message.
- `sql.end()` called before exit to close the database connection.
- Silent catch blocks (empty `catch {}`) for non-critical failures: DB task output updates, process cleanup, file removal.

### Naming
- Functions: camelCase (`dispatchAgent`, `monitorTask`, `assembleProjectContext`).
- Interfaces: PascalCase (`TaskHandle`, `AgentBackend`, `MonitorOptions`).
- Constants: UPPER_SNAKE_CASE for module-level constants (`SHARED_PATTERNS`, `SPINNER`, `TIMEOUT_MS`).
- Database columns: snake_case (`agent_slug`, `exit_code`, `last_output_at`).
- CLI commands: lowercase single words (`start`, `setup`, `learn`, `new`).

### Shared Helpers That Don't Exist Yet
- `getProjectId()` is duplicated identically in `learn.ts` and `new.ts` — queries `projects` by `root_path`.
- `slugify()` appears in both `new.ts` and `init.ts` with slightly different implementations (one truncates to 60 chars, the other doesn't).
- All shared helpers should be extracted when possible.

## Testing Strategy

No tests exist. No test runner is configured. No linter or CI pipeline is set up. The only validation command is `npx tsc --noEmit` for typechecking. The project is still in an early developmental phase where testing hasn't been prioritized.

The scanner module (`src/lib/scanner.ts`) detects `vitest` as the expected test runner for projects it analyzes, which signals intent to use vitest when tests are added.

## Build & Deployment

murder runs entirely locally. There is no deploy pipeline, no CI, no production environment.

- **CLI**: `bin/murder` is a shell wrapper that resolves symlinks and runs `tsx src/index.ts`. No compilation step — TypeScript runs directly via tsx.
- **Installation**: Clone repo → `pnpm install` → symlink `bin/murder` to `/usr/local/bin/murder`.
- **Database**: `docker compose up -d --build` from project root. Postgres 18 with pgvector and pg_cron extensions.
- **Web UI**: `npx react-router dev --port 1314`, spawned as a detached background process by `murder start`.
- **Package manager**: pnpm. The `package.json` has a single script: `"dev": "tsx src/index.ts"`.
- **TypeScript config**: `"strict": true`, target ES2022, `outDir: "dist"` and `rootDir: "src"` are configured but the dist output is never used — everything runs via tsx.

## Database & Data Layer

### Connection
`src/lib/db.ts` exports a single `postgres.js` connection with no pool size configuration, connection timeout, or retry logic. Environment variables (`MURDER_DB_HOST`, `MURDER_DB_PORT`, `MURDER_DB_USER`, `MURDER_DB_PASSWORD`, `MURDER_DB_NAME`) override defaults. The web UI has its own mirrored connection in `web/app/lib/db.server.ts` with the same config.

### Query Patterns
- Raw SQL via `postgres.js` tagged template literals: `` sql`SELECT * FROM table WHERE id = ${id}` ``.
- UUID parameters cast explicitly: `${id}::uuid`.
- Query results are cast via `as unknown as Type` — no type-safe query layer.
- No ORM. No query builder.

### Schema Design
- UUID primary keys with `gen_random_uuid()` defaults on all tables.
- `created_at` and `updated_at` timestamps with a shared `set_updated_at()` trigger function.
- `metadata JSONB NOT NULL DEFAULT '{}'` column on tables for extensibility.
- Unique partial indexes enforce constraints like one active config per capability per scope.

### Migrations
- Ordered SQL files in `docker/postgres/migrations/` named `NNN_description.sql`.
- `src/lib/migrate.ts` runs migrations by shelling out to `docker compose exec -T postgres psql` for every SQL operation. This means migrations only work when Docker is up and accessible via `docker compose`.
- Docker entrypoint also runs migrations on first boot via volume mount to `/docker-entrypoint-initdb.d`. The migration runner has special first-run detection logic to backfill the `schema_migrations` tracking table when Docker already ran the migrations. This dual-path is a known source of potential drift.
- `schema_migrations` table tracks applied migrations by filename.

### Active Tables
- `projects` — registered codebases (name, slug, root_path, metadata).
- `ai_providers` — seeded provider registry (OpenAI, Anthropic, OpenRouter, Vercel AI Gateway, Voyage).
- `ai_provider_keys` — encrypted API keys (one per provider, AES-256-GCM).
- `ai_configs` — active model configuration per capability (orchestration or embeddings), optionally project-scoped.
- `agent_backends` — detected agent CLI tools (currently only Cursor CLI).
- `tasks` — dispatched agent work with PID, status, log path, timing, diagnosis.

### Unused Tables (Still in Schema)
- `conversations` and `conversation_messages` — superseded by the task-based model.
- `memory_migrations` and `mem0_memories` — wired up for mem0 but never used in any command flow.

## API & Integration Patterns

### Agent Dispatch (Cursor CLI)
- Agents are spawned via `spawn("/bin/sh", ["-c", shellCmd])` in `src/lib/dispatch.ts`.
- Prompts are written to temp files in `.murder/logs/` and read via `$(cat 'path')` to avoid shell argument length limits.
- Cursor CLI flags: `-p` (prompt mode), `--force`, `--output-format stream-json`, `--model <name>`.
- Three output modes: `inherit` (full TTY passthrough), `stream-json` (parsed NDJSON events), `pipe` (silent log capture).
- `stream-json` mode parses Cursor CLI's NDJSON events in `displayStreamEvent()`, which handles `system` (init/model), `tool_call` (read/write/edit/shell/glob/grep/list), and `result` (duration) event types.
- The dispatch system is tightly coupled to Cursor CLI's interface — `buildShellCommand()` hardcodes Cursor-specific flags and `displayStreamEvent()` parses Cursor-specific event shapes.

### Quick Agent (`runQuickAgent`)
- A separate, simpler dispatch path in `new.ts` that bypasses the full `dispatchAgent()` → `monitorTask()` pipeline.
- Used only for slug generation (a trivial prompt). Has its own 30-second timeout.
- Extracts text from stream-json output via `extractNameFromStreamJson()`.

### Preflight Check
- `src/lib/preflight.ts` runs `execSync` (blocking, up to 15 seconds) with a trivial prompt (`"respond with OK"`) to verify the agent CLI is responsive and authenticated before committing to a full dispatch.
- Parses failure output to produce user-friendly error messages (auth issues, missing API key, command not found, rate limits).

### AI Provider Resolution
- `src/lib/ai.ts` resolves the active AI config from the database for a given capability (orchestration or embeddings).
- Supports Anthropic (direct via `@ai-sdk/anthropic`) and OpenAI-compatible providers (via `@ai-sdk/openai`).
- Provider instances are cached in a `Map` keyed by `slug:keyAlias` so key rotation invalidates the cache.
- Used only by `src/lib/diagnosis.ts` for stuck detection AI diagnosis via Vercel AI SDK's `generateText()`.

### Encryption
- `src/lib/crypto.ts` implements AES-256-GCM encryption for API keys.
- Master key stored at `~/.murder/secret.key` (auto-generated with `mode: 0o600`).
- `~/.murder/` directory created with `mode: 0o700`.
- Encrypted values stored as hex strings in `iv:authTag:ciphertext` format.

### GitHub CLI
- `src/lib/worktree.ts` uses `gh pr create` for automated PR creation after `murder new`.
- Detects `gh` availability via `which gh`. Falls back to manual instructions if not available.
- PRs target `main` branch from `murder/<slug>` feature branches.

## Performance Considerations

- `assembleProjectContext()` reads all `.murder/` knowledge files synchronously on every command invocation using `readFileSync`. As knowledge files grow, this injects increasingly large context blocks into every agent prompt.
- The preflight check (`preflight.ts`) runs a synchronous `execSync` call that blocks the event loop for up to 15 seconds.
- The migration runner shells out to `docker compose exec` for every SQL operation (table existence checks, reading applied migrations, executing each migration file), which is slow but only runs during `murder start`.
- Agent dispatch spawns a new `/bin/sh` process for each agent invocation. The `murder new` pipeline dispatches 4+ sequential agent invocations (slug generation, PM PRD, EM plan, N engineer phases, N EM reviews, post-mortem). A typical full pipeline takes 30-45 minutes for normal tasks, with individual agents finishing in 3-5 minutes.
- The heartbeat monitor polls log file size every 5-10 seconds using `statSync`. This is lightweight.
- Progress tracking uses atomic JSON file writes (write to `.tmp` then `renameSync`) to avoid partial reads.

## Security Practices

- API keys are encrypted with AES-256-GCM before storage in the database. The master key at `~/.murder/secret.key` is auto-generated with restrictive file permissions (`0o600` for the key, `0o700` for the directory).
- The threat model assumes a single-user, single-machine environment. This tool is not designed for shared machines or remote Docker hosts.
- Agent prompts written to temp files in `.murder/logs/` contain full project context (architecture, business logic, API patterns). These prompt files are not explicitly cleaned up after successful agent runs — they accumulate in the logs directory. The intent is that they should be removed after each successful agent run.
- Database credentials are hardcoded defaults (`murder`/`murder`) with environment variable overrides. Acceptable for local-only operation.
- The web UI has no authentication — it's a local dev tool running on localhost:1314.

## Technical Debt & Known Issues

- **Duplicated CLI helpers**: `step()`, `ok()`, `fail()`, `divider()`, `formatDuration()` are copy-pasted across `learn.ts`, `new.ts`, `em-loop.ts`, and `heartbeat.ts`.
- **Duplicated `getProjectId()`**: Identical function in both `learn.ts` and `new.ts`.
- **Divergent `slugify()`**: Two implementations in `new.ts` (truncates to 60 chars) and `init.ts` (no truncation).
- **Context injection injects full file contents**: `formatContextForPrompt()` concatenates all knowledge file contents into every prompt. The intent is to instead provide a table of contents so agents retrieve what they need.
- **Unused dependencies**: `mem0ai`, `@modelcontextprotocol/sdk`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `ai` (Vercel AI SDK), and `zod` are in `package.json`. Only the AI SDK packages are actively used (solely for stuck detection diagnosis in `src/lib/diagnosis.ts`). The rest are dead weight.
- **Unused code**: `src/mcp/` directory, `src/lib/pgvector.ts` (PGVectorStore for mem0).
- **Unused database tables**: `conversations`, `conversation_messages`, `memory_migrations`, `mem0_memories`.
- **Dual migration path**: Docker entrypoint runs migrations on first boot AND `migrate.ts` runs them via `docker compose exec`. The first-run detection logic in `migrate.ts` bridges this but it's fragile.
- **Web UI data model lag**: Dashboard references `mem0_memories` and `conversations` tables (with `safeMemoryCount()` try/catch wrapper). The `ALL_CAPABILITIES` array lists `["embeddings", "chat", "decisions", "extraction"]` but the actual `ai_configs` table only uses `"embeddings"` and `"orchestration"`.
- **Hand-rolled prompt system**: `src/lib/prompt.ts` implements interactive CLI prompts from scratch using raw stdin instead of using an established library like inquirer or prompts.
- **Tight Cursor CLI coupling**: `buildShellCommand()` and `displayStreamEvent()` in `dispatch.ts` are hardcoded for Cursor CLI's interface and NDJSON event shapes.
- **`runQuickAgent()` bypass**: A separate dispatch path in `new.ts` that duplicates dispatch logic instead of going through the standard `dispatchAgent()` pipeline.
- **Prompt file accumulation**: Prompt files in `.murder/logs/` are not cleaned up after successful agent runs.
- **Stuck detection thresholds are arbitrary**: 30s default, 120s for learn/new, 300s for engineer phases — not tuned to observed agent behavior. Agents typically finish in 3-5 minutes.
- **`murder learn` is not resumable**: If cancelled mid-pipeline, the entire 6-phase process restarts from the beginning.
- **AI diagnosis contradicts agent-first direction**: `src/lib/diagnosis.ts` calls the Vercel AI SDK directly via `generateText()`, which is the only place direct model API calls are made.

## Development Workflow

- Single developer (sole contributor).
- Primary development happens in Cursor Desktop to avoid conflicts when dogfooding `murder new` on the murder codebase itself.
- When dogfooding `murder new` for smaller tasks, the agent output is trusted with a quick review.
- Feature branches use the `murder/<slug>` naming pattern (created by `murder new`).
- Agent work happens in an isolated git worktree at `.murder/worktrees/work/` — the main working tree stays clean.
- PRs are created automatically via `gh` CLI if available.
- No code review process beyond the developer's own review.
- No CI pipeline — the only validation is `npx tsc --noEmit`.
- `.murder/worktrees/` and `.murder/logs/` are gitignored as transient artifacts.
