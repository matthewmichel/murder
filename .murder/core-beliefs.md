# Core Beliefs & Conventions

Derived from the actual codebase patterns. Follow these when contributing.

## Language & Module System

- **TypeScript strict mode** — `"strict": true` in tsconfig.json
- **ES2022 target** with ESM (`"type": "module"` in package.json)
- **All imports use `.js` extensions** — even for `.ts` files. This is required for ESM resolution with tsx/Node.js. Example: `import { x } from "./foo.js"` not `import { x } from "./foo"`.
- **Bundler module resolution** — `"moduleResolution": "bundler"` in tsconfig

## Code Style

- **No external CLI framework** — commands are plain async functions, routing is a simple if/else chain in `src/index.ts`
- **Custom prompt system (migration planned)** — interactive prompts are currently implemented from scratch using raw stdin in `src/lib/prompt.ts`. This was built without awareness of standard CLI prompt libraries and is planned to be replaced with an established library like inquirer or prompts.
- **Pragmatic dependencies** — the project prefers standard, well-maintained packages over hand-rolled implementations when they exist. The migration runner is hand-rolled for simplicity. Use standard approaches that are common across CLI tools.
- **Console output formatting** — use `step()`, `ok()`, `fail()` helper functions for consistent CLI output. Prefix with two spaces for indentation. Use Unicode symbols: `●` for steps, `✓` for success, `✗` for failure, `⚠` for warnings. These helpers are currently duplicated across command files and should be extracted into a shared utility module (e.g., `src/lib/cli-utils.ts`).

## File Organization

- **One command per file** in `src/commands/` — each exports a single async function
- **Library modules** in `src/lib/` — each file is a focused module with clear responsibility
- **Types defined inline** — interfaces and types are defined in the file that uses them, not in separate type files. Use `export interface` at the top of the module.
- **Section separators** — use `// ---------------------------------------------------------------------------` comment blocks to visually separate sections within files (Types, Helpers, Public API, etc.)

## Database Patterns

- **Raw SQL via postgres.js** — currently no ORM. Use tagged template literals: `` sql`SELECT * FROM table WHERE id = ${id}` ``. A migration to Drizzle ORM is being considered for the future to get typed query results.
- **UUID primary keys** — all tables use `gen_random_uuid()` defaults
- **JSONB metadata columns** — tables include a `metadata JSONB NOT NULL DEFAULT '{}'` column for extensibility
- **Timestamps** — `created_at` and `updated_at` with `set_updated_at()` trigger function
- **Migrations are ordered SQL files** — named `NNN_description.sql` in `docker/postgres/migrations/`
- **No database functions for business logic** — keep logic in TypeScript, not in stored procedures or triggers (exception: the `set_updated_at()` trigger and pg_cron stale task check)
- **Type casting in queries** — use `${id}::uuid` for UUID parameters

## Error Handling

- **Try/catch at command boundaries** — each command handler wraps its logic in try/catch
- **User-friendly error messages** — never expose raw stack traces. Print a clear message and suggest next steps.
- **`process.exit(1)` for fatal errors** — after printing the error message
- **Silent catch for non-critical failures** — DB task output updates, process cleanup, etc. use empty catch blocks
- **`sql.end()` before exit** — always close the database connection before exiting

## AI & Agent Patterns

- **Provider abstraction** — AI providers are resolved from the database at runtime. The `resolveConfig()` function handles global vs project-scoped configs with fallback.
- **Provider caching** — provider instances are cached in a `Map` keyed by `slug:keyAlias` so key rotation invalidates the cache.
- **Prompt-as-file** — long prompts are written to temp files in `.murder/logs/` and read via `$(cat 'path')` to avoid shell argument length limits. Prompt files MUST be cleaned up after the agent finishes successfully to avoid accumulating sensitive data (they contain full project context).
- **Three-tier monitoring** — stuck detection uses: (1) cheap regex patterns, (2) expensive AI diagnosis (run once per silence window), (3) human escalation as last resort.
- **Conservative stuck detection** — killing a working agent is worse than waiting. The system defaults to "continue" when uncertain.
- **Agent-first direction** — all AI work should go through agent backends (Cursor CLI, etc.), not through direct model API calls. The Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) is slated for removal. Do not add new code that calls AI APIs directly from murder — dispatch to the agent instead.
- **Context as table of contents, not full injection** — the intent is for agent prompts to describe what each `.murder/` knowledge file contains and where it lives, so agents can retrieve context on demand. The current implementation (`formatContextForPrompt()`) injects full file contents, which is a known issue that needs to be fixed.
- **Context refresh between phases** — when a multi-phase command (like `murder learn`) produces knowledge files mid-run, it re-assembles project context so later phases see the new files.
- **If/else for agent backends** — when adding new agent backends (Claude Code, Codex CLI), use if/else branches in `buildShellCommand()` and `displayStreamEvent()` rather than an adapter/strategy pattern. Keep it simple.

## Git & Worktree Conventions

- **Feature branches** — `murder/<slug>` naming pattern
- **Worktree isolation** — agent work happens in `.murder/worktrees/work/`, not in the main working tree
- **PR creation** — uses `gh` CLI if available, falls back to manual instructions
- **`.murder/worktrees/` and `.murder/logs/` are gitignored** — these are transient artifacts

## Web UI Conventions

- **React Router v7** with file-based routing in `web/app/routes/`
- **Functional React components** only
- **Tailwind CSS v4 + DaisyUI v5** — use DaisyUI component classes and Tailwind utilities. Theme: `night`.
- **Server-side data loading** — use React Router loaders
- **Shared server utilities** — `web/app/lib/db.server.ts` and `web/app/lib/crypto.server.ts` mirror the CLI's `src/lib/` modules

## Import Conventions

- **Relative imports** — all internal imports are relative paths with `.js` extensions
- **Type-only imports** — use `import type { X }` for types that aren't used at runtime
- **No barrel files** — import directly from the specific module file
- **Node built-ins** — use `node:` prefix for Node.js built-in modules in web code; CLI code uses bare specifiers (`"fs"`, `"path"`, `"crypto"`)

## Testing

- **No test suite exists yet** — no test runner is configured. When tests are added, the project uses `vitest` as the expected runner (based on the scanner's detection logic).

## What NOT to Do

- Do not create database functions or triggers for business logic
- Do not use an ORM yet — stick with raw SQL via postgres.js (Drizzle migration is planned but not started)
- Do not add new hand-rolled implementations when a standard library exists — prefer established packages for CLI interactions
- Do not run `supabase db push`
- Do not create markdown summary files unless explicitly asked
- Do not use class components in React — functional components only
