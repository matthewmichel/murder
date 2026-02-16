# murder — Agent Development Guide

**murder** is a local CLI tool that orchestrates AI coding agents to accomplish tasks in your codebase. It learns over time through a memory system backed by Postgres + pgvector.

## Tech Stack

- **Language**: TypeScript (ES2022, ESM)
- **Runtime**: Node.js with tsx for dev
- **Package Manager**: pnpm
- **Database**: Postgres 18 (Docker) with pgvector + pg_cron
- **AI SDKs**: Vercel AI SDK (@ai-sdk/anthropic, @ai-sdk/openai)
- **Memory**: mem0ai + pgvector for semantic memory
- **Web UI**: React Router v7 + Tailwind CSS v4 + DaisyUI v5

## Project Structure

```
murder/
├── src/                    # CLI application source
│   ├── commands/          # CLI command handlers (init, start, stop, setup, etc.)
│   ├── lib/               # Core libraries (agents, dispatch, db, scanner, etc.)
│   └── index.ts           # CLI entry point
├── web/                   # Management web UI
│   └── app/               # React Router v7 application
├── docker/                # Database container
│   └── postgres/          # Postgres 18 + pgvector + pg_cron
│       └── migrations/    # Database schema migrations
├── bin/murder             # CLI executable (symlink to /usr/local/bin)
└── .murder/               # Project-specific agent context (in target projects)
```

## Key Directories

- **src/commands/**: CLI command implementations (init, start, stop, setup, project, reset, status)
- **src/lib/**: Core functionality modules
  - `agents.ts`: Agent detection and registration
  - `dispatch.ts`: Agent task dispatching and process management
  - `db.ts`: Postgres connection (postgres library)
  - `scanner.ts`: Project analysis (languages, frameworks, config detection)
  - `heartbeat.ts`: Task monitoring with stuck detection
  - `diagnosis.ts`: AI-powered stuck agent diagnosis
  - `patterns.ts`: Pattern matching for known stuck states
  - `preflight.ts`: Agent smoke tests before dispatch
  - `prompt.ts`: Interactive CLI prompts
  - `crypto.ts`: API key encryption
  - `pgvector.ts`: Vector store initialization
  - `migrate.ts`: Database migration runner
- **web/app/routes/**: Web UI pages (dashboard, projects, providers, configs, agents)
- **docker/postgres/migrations/**: SQL migration files (001-007)

## Validation Commands

After making changes, run:

```bash
# Typecheck (no build step configured yet)
npx tsc --noEmit

# No linter configured (add eslint/biome if needed)

# No test runner configured (add vitest/jest if needed)

# Dev server (CLI)
pnpm dev

# Web UI dev server
cd web && pnpm dev
```

## Common Tasks

### Add a new CLI command
1. Create `src/commands/your-command.ts` with an exported async function
2. Import and wire it in `src/index.ts`
3. Add help text to the banner in `src/index.ts`

### Add a database migration
1. Create `docker/postgres/migrations/00X_name.sql`
2. Restart the database container (migrations run on init)
3. For running migrations: use `src/lib/migrate.ts`

### Modify agent dispatch behavior
- Edit `src/lib/dispatch.ts` for process spawning and output handling
- Edit `src/lib/heartbeat.ts` for monitoring and stuck detection
- Edit `src/lib/patterns.ts` for known stuck patterns

### Add a new web UI route
1. Create `web/app/routes/your-route.tsx` (React Router v7 file-based routing)
2. Add navigation link in `web/app/root.tsx` if needed

## Conventions

- **ES Modules**: All imports use `.js` extensions (TypeScript + ESM)
- **Database queries**: Use `postgres` library tagged templates (not an ORM)
- **Error handling**: Try/catch with graceful degradation (no global error handlers)
- **Process management**: Spawn agents via `/bin/sh -c` for shell features
- **Output formats**: Three modes: `inherit` (full TTY), `stream-json` (parsed events), `pipe` (log file)
- **Async/await**: Preferred over callbacks or promises chains
- **No build step**: Development uses `tsx` for direct TS execution
- **Functional style**: Prefer pure functions, minimal classes

## Database Schema

See `.murder/ARCHITECTURE.md` for full schema details. Key tables:
- `projects`: Registered codebases
- `agent_backends`: Detected CLI agents (cursor-cli, etc.)
- `ai_providers`: AI provider registry (OpenAI, Anthropic, etc.)
- `ai_provider_keys`: Encrypted API keys (BYOK)
- `ai_configs`: Model selection per capability (embeddings, orchestration)
- `tasks`: Dispatched agent work with heartbeat tracking
- `conversations`: Agent session history
- `mem0_memories`: Vector embeddings for project memory

## Architecture Deep Dive

For detailed architecture, data flow, and design decisions, see:
→ `.murder/ARCHITECTURE.md`

## Core Beliefs

For code style conventions, patterns, and contribution guidelines, see:
→ `.murder/core-beliefs.md`
