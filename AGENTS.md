# AGENTS.md — murder

murder is a local CLI tool that orchestrates AI coding agents (currently Cursor CLI) to accomplish tasks in your codebase. It provides a Postgres-backed brain for tracking projects, tasks, and agent history, plus a web UI for management. Run `murder init` on a project to make it agent-ready, then `murder new "<prompt>"` to plan and execute work through a PM → EM → Engineer agent pipeline.

## Tech Stack

| Component | Details |
|-----------|---------|
| Language | TypeScript (ES2022, ESM) |
| Runtime | Node.js via tsx |
| Package manager | pnpm |
| Database | Postgres 18 (Docker) on port 1313 |
| Extensions | pgvector (embeddings), pg_cron (scheduled jobs) |
| AI SDK | Vercel AI SDK (`ai`), `@ai-sdk/anthropic`, `@ai-sdk/openai` |
| Memory | mem0ai + custom PGVectorStore |
| Web UI | React Router v7, Tailwind CSS v4, DaisyUI v5 |
| Encryption | AES-256-GCM for API keys (master key at `~/.murder/secret.key`) |

## Directory Map

```
src/
├── index.ts              CLI entry point — routes commands to handlers
├── commands/             Command implementations (init, new, start, stop, setup, status, project, reset)
├── lib/                  Core library modules
│   ├── ai.ts             AI provider resolution + model factories
│   ├── agents.ts         Agent detection, registration, model selection
│   ├── context.ts        Reads .murder/ knowledge files for prompt injection
│   ├── crypto.ts         AES-256-GCM encrypt/decrypt for API keys
│   ├── db.ts             Postgres connection (postgres.js)
│   ├── diagnosis.ts      AI-powered stuck agent diagnosis
│   ├── dispatch.ts       Spawns agent processes, captures output, tracks tasks in DB
│   ├── em-loop.ts        Engineer/Manager execution loop (phased work + review)
│   ├── heartbeat.ts      Monitors running agents, detects stuck processes
│   ├── migrate.ts        SQL migration runner (docker/postgres/migrations/)
│   ├── models.ts         Cursor CLI model constants
│   ├── patterns.ts       Regex-based stuck detection patterns
│   ├── pgvector.ts       Custom PGVectorStore for mem0
│   ├── preflight.ts      Smoke tests agent CLI before dispatch
│   ├── progress.ts       progress.json read/write/mutation for exec plans
│   ├── prompt.ts         Interactive CLI prompts (select, text, confirm, secret)
│   ├── prompts.ts        Prompt builders for PM, EM, Engineer, Review agents
│   ├── providers.ts      AI provider CRUD (keys, configs)
│   ├── scanner.ts        Project analysis (languages, frameworks, scripts, configs)
│   └── worktree.ts       Git worktree + branch management for isolated agent work
└── mcp/                  (placeholder) MCP server integration

web/                      Management web UI (React Router v7)
├── app/
│   ├── root.tsx          Layout with sidebar nav (DaisyUI night theme)
│   ├── routes.ts         Route config (dashboard, providers, configs, agents, projects)
│   ├── routes/           Page components
│   └── lib/              Server-side DB + crypto (mirrors src/lib/)

docker/postgres/          Postgres 18 container with pgvector + pg_cron
├── Dockerfile
└── migrations/           Ordered SQL migrations (001-008)

bin/murder                Shell wrapper — resolves symlinks, runs tsx src/index.ts
```

## Validation Commands

```bash
# Typecheck (no build script exists — use tsc directly)
npx tsc --noEmit

# No linter, test runner, or build script configured yet
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `murder start` | Boots Docker DB, runs migrations, detects agents, starts web UI on :1314 |
| `murder setup` | Interactive wizard to configure AI provider (API key + models) |
| `murder init` | Scans cwd, dispatches agent to generate AGENTS.md + .murder/ knowledge files |
| `murder new "<prompt>"` | Full pipeline: PM writes PRD → EM creates plan → Engineer executes phases → EM reviews → Post-mortem → PR |
| `murder status` | Shows active and recent agent tasks |
| `murder stop` | Stops Docker containers + web UI |
| `murder reset` | Factory reset — destroys all data |
| `murder project` | Register/view current directory as a murder project |

## Conventions

- **ESM only** — all imports use `.js` extensions (`import { x } from "./foo.js"`)
- **No external CLI frameworks** — commands are plain async functions routed by `process.argv[2]`
- **Interactive prompts** — custom raw-mode stdin handlers in `src/lib/prompt.ts` (no inquirer/prompts dependency)
- **Database access** — `postgres.js` library, raw SQL queries (no ORM)
- **Error pattern** — try/catch with user-friendly console messages, `process.exit(1)` on fatal errors
- **Agent dispatch** — all agent work goes through `dispatchAgent()` → `monitorTask()` with heartbeat + stuck detection
- **Git worktrees** — `murder new` creates isolated worktrees for agent work, auto-creates PRs

## Common Tasks

**Add a new CLI command:** Create `src/commands/<name>.ts` exporting an async function, add routing in `src/index.ts`.

**Add a new database table:** Create a new migration file in `docker/postgres/migrations/` following the `NNN_description.sql` naming pattern.

**Add a web UI page:** Create route component in `web/app/routes/`, register in `web/app/routes.ts`.

**Modify agent dispatch behavior:** Edit `src/lib/dispatch.ts` (spawning), `src/lib/heartbeat.ts` (monitoring), or `src/lib/patterns.ts` (stuck detection).

## Deeper Context

See `.murder/ARCHITECTURE.md` for system architecture, data flow, dependency graph, and database schema.
See `.murder/core-beliefs.md` for code style conventions and patterns.
