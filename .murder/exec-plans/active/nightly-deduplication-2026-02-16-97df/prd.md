# PRD: Deduplicate Recent Changes on Main

## Overview

Two PRs were merged to main within the last 6 hours: PR #2 (scheduled jobs feature) and PR #3 (context injection rewrite to table-of-contents). These PRs were developed on parallel branches and introduce significant code duplication — both between each other and by amplifying existing duplication already documented as tech debt. This task identifies and eliminates that duplication by extracting shared code into reusable modules.

## Goals

- Eliminate all duplicated helper functions (`step()`, `ok()`, `fail()`, `divider()`, `formatDuration()`) by extracting them into a single shared module at `src/lib/cli-utils.ts`.
- Consolidate the duplicated `getProjectId()` function (identical in `src/commands/learn.ts` and `src/commands/new.ts`) into a shared location.
- Unify the divergent `slugify()` implementations (4 copies across `src/commands/new.ts`, `src/commands/init.ts`, `src/commands/project.ts`, and `web/app/routes/jobs.tsx`) into a single canonical version.
- Eliminate the duplicated `murder new` pipeline logic between `src/commands/new.ts` (interactive CLI) and `src/lib/run-new-task.ts` (programmatic, used by job executor) by having the CLI command delegate to the shared programmatic implementation.
- Eliminate the duplicated `formatDuration()` in `src/lib/run-new-task.ts` and `src/lib/heartbeat.ts` by importing from the shared module.
- Ensure the codebase passes `npx tsc --noEmit` after all changes.

## Non-Goals

- **No new features.** This is purely a deduplication and refactoring task.
- **No changes to the jobs feature logic, web UI, or database schema.** The jobs system (PR #2) and context injection rewrite (PR #3) stay functionally identical.
- **No changes to agent dispatch, heartbeat, or monitoring behavior.**
- **No removal of unused dependencies or tables.** That's tracked separately in FUTURE.md.
- **No changes to prompt templates** in `src/lib/prompts.ts`. The "table of contents" phrasing added by PR #3 is intentional and stays.
- **No consolidation of `runQuickAgent()` into `dispatchAgent()`.** That's a separate future task.

## User Stories

- As a developer contributing to murder, I want shared utility functions in one place so that I don't have to update the same function in 6 different files when making a change.
- As a developer adding a new CLI command, I want to import `step()`, `ok()`, `fail()`, `divider()`, and `formatDuration()` from a shared module so I don't have to copy-paste them again.
- As a developer maintaining the `murder new` pipeline, I want one implementation of the PM → EM → Engineer → Post-mortem flow so that bug fixes and improvements only need to happen once, not in both `new.ts` and `run-new-task.ts`.

## Technical Considerations

### Existing systems this touches

- `src/commands/new.ts` — duplicated CLI helpers, `getProjectId()`, `slugify()`, and the full `murder new` pipeline (which is largely duplicated in `run-new-task.ts`)
- `src/commands/learn.ts` — duplicated CLI helpers and `getProjectId()`
- `src/commands/init.ts` — duplicated CLI helpers and `slugify()`
- `src/commands/start.ts` — duplicated `step()`, `ok()`, `fail()`
- `src/commands/project.ts` — duplicated `slugify()`
- `src/lib/em-loop.ts` — duplicated `ok()`, `fail()`, `divider()`, `formatDuration()`
- `src/lib/heartbeat.ts` — duplicated `formatDuration()`
- `src/lib/run-new-task.ts` — duplicated `formatDuration()` and the full `murder new` pipeline
- `web/app/routes/jobs.tsx` — duplicated `slugify()` (web-side, may stay separate or import from shared)

### New modules needed

- `src/lib/cli-utils.ts` — shared CLI output helpers (`step()`, `ok()`, `fail()`, `divider()`, `formatDuration()`, `slugify()`, `getProjectId()`)

### Refactoring `new.ts` to use `run-new-task.ts`

The `src/lib/run-new-task.ts` module was created by PR #2 as a programmatic (non-interactive) version of the `murder new` pipeline for use by the job executor. It duplicates ~90% of the logic in `src/commands/new.ts`. The interactive `new.ts` command should be refactored to:
1. Handle its own interactive concerns (prompt parsing, agent selection with interactive fallback, CLI output/progress display)
2. Delegate the actual pipeline execution to `runNewTaskProgrammatic()` from `run-new-task.ts`
3. Wrap the result with appropriate CLI output (success/failure messages, duration display)

This way `run-new-task.ts` becomes the single source of truth for the pipeline, and `new.ts` is a thin interactive wrapper.

### Database changes

None required.

### API changes

None required.

### Patterns to follow

- ESM imports with `.js` extensions
- Section separators (`// ---...`) between Types, Helpers, Public API
- `export function` for public utilities
- Existing error handling patterns (try/catch at command boundaries)
- The `web/app/routes/jobs.tsx` `slugify()` may remain separate since it's client-side React code that can't import from `src/lib/` — evaluate whether a shared approach is practical or if keeping the web copy is the pragmatic choice

## Acceptance Criteria

- [ ] A new `src/lib/cli-utils.ts` module exists, exporting `step()`, `ok()`, `fail()`, `divider()`, `formatDuration()`, `slugify()`, and `getProjectId()`.
- [ ] `src/commands/new.ts` imports all shared helpers from `src/lib/cli-utils.ts` and no longer defines them locally.
- [ ] `src/commands/learn.ts` imports all shared helpers from `src/lib/cli-utils.ts` and no longer defines them locally.
- [ ] `src/commands/init.ts` imports shared helpers from `src/lib/cli-utils.ts` and no longer defines them locally.
- [ ] `src/commands/start.ts` imports `step()`, `ok()`, `fail()` from `src/lib/cli-utils.ts` and no longer defines them locally.
- [ ] `src/commands/project.ts` imports `slugify()` from `src/lib/cli-utils.ts` and no longer defines it locally.
- [ ] `src/lib/em-loop.ts` imports `ok()`, `fail()`, `divider()`, `formatDuration()` from `src/lib/cli-utils.ts` and no longer defines them locally.
- [ ] `src/lib/heartbeat.ts` imports `formatDuration()` from `src/lib/cli-utils.ts` and no longer defines it locally.
- [ ] `src/lib/run-new-task.ts` imports `formatDuration()` from `src/lib/cli-utils.ts` and no longer defines it locally.
- [ ] `slugify()` has one canonical implementation that truncates to 60 characters (the stricter version from `new.ts`).
- [ ] `src/commands/new.ts` delegates pipeline execution to `runNewTaskProgrammatic()` from `src/lib/run-new-task.ts`, removing the duplicated pipeline logic. The interactive concerns (prompt parsing, user-facing output, agent selection with interactive prompt) remain in `new.ts` as a wrapper.
- [ ] The `murder new` command behaves identically from the user's perspective (same output, same flow, same PR creation).
- [ ] The job executor continues to work identically (it already uses `runNewTaskProgrammatic()`).
- [ ] `npx tsc --noEmit` passes with no errors.
- [ ] No new files are created other than `src/lib/cli-utils.ts`.

## Edge Cases & Risks

- **`slugify()` behavioral difference**: The `new.ts` version truncates to 60 chars; `init.ts` and `project.ts` don't truncate. Unifying to the 60-char version could theoretically truncate slugs that were previously longer, but since slugs are used for branch names and directory paths, 60 chars is a reasonable limit and the safer default.
- **`web/app/routes/jobs.tsx` `slugify()`**: This runs client-side in the browser and cannot import from `src/lib/`. It should remain as a local copy unless a shared package structure is introduced. Document this as an intentional exception.
- **`new.ts` refactoring risk**: The interactive `new.ts` command has subtle differences from `run-new-task.ts` — it calls `process.exit()`, uses interactive agent selection, and prints detailed progress output. The refactoring must preserve all interactive behavior while delegating the pipeline. If the refactoring proves too risky or complex, the fallback is to only extract shared helpers and defer the pipeline consolidation.
- **Import path changes**: All imports must use `.js` extensions per project convention. Missing extensions will cause runtime failures even if TypeScript compiles.
- **Circular dependency risk**: `getProjectId()` uses `sql` from `src/lib/db.ts`. Putting it in `cli-utils.ts` means that module imports `db.ts`. This is fine since `db.ts` has no dependencies on `cli-utils.ts`, but verify no circular imports are introduced.
