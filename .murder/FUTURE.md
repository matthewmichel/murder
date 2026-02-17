# Future Direction

## Near-Term Priorities

- **Remove mem0ai and PGVectorStore**: The `mem0ai` dependency and `src/lib/pgvector.ts` are wired up but not used in any command flow. These should be removed along with the `memory_migrations` and `mem0_memories` database tables.

- **Remove @modelcontextprotocol/sdk and src/mcp/**: The MCP SDK dependency and the `src/mcp/` directory are unused. The git worktree approach replaced the original plan of spinning up separate Docker containers for each agent.

- **Remove unused database tables**: The `conversations` and `conversation_messages` tables are unused — the task-based model has fully superseded them. Remove these tables and their migration artifacts.

- **Deduplicate CLI output helpers**: The `step()`, `ok()`, `fail()`, `divider()`, and `formatDuration()` functions are copy-pasted across `src/commands/learn.ts`, `src/commands/new.ts`, and `src/lib/em-loop.ts`. Extract these into a shared utility module (e.g., `src/lib/cli-utils.ts`).

## Planned Features

- **Additional agent backends (Codex CLI, Claude Code)**: The `agent_backends` table and detection system are designed for multiple backends. Adding Codex CLI and Claude Code requires tweaking the shell commands in `src/lib/dispatch.ts` to match each agent's CLI interface and parsing their output/progress formats.

- **`murder edit` command**: A lightweight command for making small tweaks to an existing PR after `murder new` has created it. Would use the post-mortem docs (files.md, notes.md) as context for targeted changes without running the full PM → EM → Engineer pipeline.

- **Saved and scheduled murders ("murder directory")**: The ability to save task definitions (which are just prompts for `murder new`) as named templates that can be scheduled to run on a consistent basis. Common maintenance tasks — dependency updates, security audits, codebase hardening — could be templatized and run automatically. This is the biggest desired capability.

- **Web UI as a fully functioning sidekick**: The web UI should be able to update and manage configuration settings (providers, models, agents, projects), not just display them read-only. It should be a complete management interface alongside the CLI.

- **Learn mode with default answers**: When re-running `murder learn` on a project that already has PM.md and EM.md, the PM and EM agents should propose default answers to their own questions based on existing context. The user then reviews and corrects these defaults. This turns `murder learn` into a litmus test — if the agents' proposed answers align with the user's intent, the knowledge base is well-calibrated. If not, the user corrects course.

- **Adopt standard CLI prompt library**: Replace the hand-rolled raw stdin prompt system in `src/lib/prompt.ts` with an established library like inquirer or prompts. The custom implementation was built without awareness of these libraries and should be replaced with standard tooling.

## Long-Term Vision

- **Background and scheduled agent execution**: murder should be able to run engineering processes in the background and on a schedule to update, maintain, and harden codebases without developer intervention. The saved murders / scheduling system is the foundation for this.

- **Multi-agent backend support as a first-class feature**: As more agent CLIs mature (Claude Code, Codex CLI, Windsurf), murder should seamlessly support switching between them or even using different backends for different task types.

- **Drizzle ORM migration**: The project currently uses raw SQL via postgres.js. A migration to Drizzle ORM is being considered for typed query results and better developer experience, but has not been started.

## Ideas & Possibilities

- **Resumable `murder learn` pipeline**: Currently if you cancel learn mode partway through, you restart from the beginning. Making it resumable (detecting which phases have completed and picking up from where you left off) would improve the experience.

- **Parallel engineer dispatch**: The EM loop currently dispatches one engineer at a time per phase. For phases with independent sections, parallel dispatch could speed up execution.

- **Agent output streaming improvements**: The `stream-json` output format parses Cursor CLI's NDJSON events. As new backends are added, a more generic event parsing layer may be needed.

- **Post-mortem feedback loop**: Using post-mortem artifacts (notes.md, files.md) to improve future task planning. The PM and EM agents could learn from past task outcomes to make better plans.

## Engineering Improvements

- **Fix context injection to use file references instead of full contents**: `formatContextForPrompt()` in `src/lib/context.ts` currently reads and concatenates all knowledge file contents into every agent prompt. This should be changed to inject a table of contents describing what each file contains and where it lives, so agents can retrieve context on demand rather than having everything injected upfront. This matters because knowledge files will grow over time and hit prompt token limits.

- **Extract shared helpers into `src/lib/cli-utils.ts`**: `step()`, `ok()`, `fail()`, `divider()`, `formatDuration()`, `getProjectId()`, and `slugify()` are duplicated across multiple command files. Extract into a single shared module. The `slugify()` implementations also need to be unified (one truncates to 60 chars, the other doesn't).

- **Consolidate `runQuickAgent()` into `dispatchAgent()`**: The separate quick-dispatch path in `new.ts` for slug generation duplicates dispatch logic. It should be folded into the standard `dispatchAgent()` pipeline, possibly with a "quick" or "fire-and-forget" option that skips full task tracking and monitoring.

- **Remove Docker entrypoint migration path**: The `docker-compose.yml` mounts migrations to `/docker-entrypoint-initdb.d`, creating a dual migration path with `migrate.ts`. Remove the Docker entrypoint mount and let `migrate.ts` be the sole migration path. This eliminates the fragile first-run detection logic and potential drift between the two paths.

- **Clean up prompt files after successful agent runs**: Prompt files written to `.murder/logs/` contain full project context and are not cleaned up after successful runs. Add cleanup logic in `dispatchAgent()` or `monitorTask()` to remove the prompt file (`.murder/logs/<taskId>.prompt`) when the agent completes successfully.

- **Sync web UI data model with CLI**: The web UI dashboard references stale tables (`mem0_memories`, `conversations`) and uses an outdated capabilities list (`["embeddings", "chat", "decisions", "extraction"]` vs the actual `"embeddings"` and `"orchestration"`). After the unused table removals, update the web UI to match the current data model.

- **Tune stuck detection thresholds based on observed data**: Current thresholds (30s default, 120s for learn/new, 300s for engineer phases) are arbitrary. Agents typically finish in 3-5 minutes with the full `murder new` pipeline taking 30-45 minutes. Gather timing data from real runs to set informed thresholds.

- **Add new agent backends via if/else in dispatch**: When adding Claude Code or Codex CLI support, use an if/else approach in `buildShellCommand()` and `displayStreamEvent()` to handle each backend's CLI interface and output format, rather than building an adapter/strategy pattern. Keep it simple.

- **Incremental dependency removal**: Remove unused dependencies one at a time in separate PRs: (1) `mem0ai` + `src/lib/pgvector.ts` + related DB tables, (2) `@modelcontextprotocol/sdk` + `src/mcp/`. Each removal is independent and low-risk.
