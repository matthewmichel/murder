# Execution Plan: Deduplicate Recent Changes on Main

## Overview
Extract duplicated CLI helpers (`step()`, `ok()`, `fail()`, `divider()`, `formatDuration()`, `slugify()`, `getProjectId()`) into a new shared module at `src/lib/cli-utils.ts`, update all consumers to import from it, and then refactor `src/commands/new.ts` to delegate its pipeline logic to `runNewTaskProgrammatic()` from `src/lib/run-new-task.ts` — making it a thin interactive wrapper.

## Phase 1: Extract shared helpers into `src/lib/cli-utils.ts`
> The EM will review the engineer's work after this phase before proceeding.

### Create the shared module
- [ ] Create `src/lib/cli-utils.ts` with section separators (Types, Helpers, Public API) following the project's file organization conventions
- [ ] Export `step(msg: string): void` — prints `  ● <msg>`
- [ ] Export `ok(msg: string): void` — prints `  ✓ <msg>\n`
- [ ] Export `fail(msg: string): void` — prints `  ✗ <msg>`
- [ ] Export `divider(): void` — prints a line of 41 `─` characters with 2-space indent
- [ ] Export `formatDuration(ms: number): string` — formats milliseconds as `Xs` or `Xm Ys`
- [ ] Export `slugify(text: string): string` — the canonical version from `src/commands/new.ts` that truncates to 60 characters
- [ ] Export `getProjectId(cwd: string): Promise<string | null>` — queries `projects` table by `root_path`, imports `sql` from `./db.js`

### Update consumers to import from the shared module
- [ ] In `src/commands/new.ts`: remove local `step()`, `ok()`, `fail()`, `divider()`, `slugify()`, `formatDuration()`, `getProjectId()` definitions and import them from `../lib/cli-utils.js`
- [ ] In `src/commands/learn.ts`: remove local `step()`, `ok()`, `fail()`, `divider()`, `formatDuration()`, `getProjectId()` definitions and import them from `../lib/cli-utils.js`
- [ ] In `src/commands/init.ts`: remove local `step()`, `ok()`, `fail()`, `slugify()` definitions and import them from `../lib/cli-utils.js`
- [ ] In `src/commands/start.ts`: remove local `step()`, `ok()`, `fail()` definitions (at the bottom of the file, lines 320-330) and import them from `../lib/cli-utils.js`
- [ ] In `src/commands/project.ts`: remove local `slugify()` definition and import it from `../lib/cli-utils.js`
- [ ] In `src/lib/em-loop.ts`: remove local `ok()`, `fail()`, `divider()`, `formatDuration()` definitions and import them from `./cli-utils.js`
- [ ] In `src/lib/heartbeat.ts`: remove local `formatDuration()` definition and import it from `./cli-utils.js`
- [ ] In `src/lib/run-new-task.ts`: remove local `formatDuration()` definition and import it from `./cli-utils.js`

### Validate
- [ ] Run `npx tsc --noEmit` and fix any type errors
- [ ] Verify no circular imports exist (cli-utils.ts → db.ts, and no reverse dependency)

## Phase 2: Refactor `new.ts` to delegate pipeline to `run-new-task.ts`
> The EM will review the engineer's work after this phase before proceeding.

### Adapt `runNewTaskProgrammatic()` for reuse by the interactive CLI
- [ ] In `src/lib/run-new-task.ts`, add an optional `onProgress` callback to `RunNewTaskOptions` (e.g., `onProgress?: (event: string, detail?: string) => void`) so the interactive CLI can receive progress updates for its console output — OR alternatively, have `new.ts` call `runNewTaskProgrammatic()` and handle output before/after the call. Evaluate which approach is cleaner and implement accordingly.
- [ ] Ensure `runNewTaskProgrammatic()` accepts the agent directly (add optional `agent?: AgentBackend` to `RunNewTaskOptions`) so the interactive CLI can pass its user-selected agent instead of relying on `agentSlug` lookup

### Refactor `src/commands/new.ts` into a thin interactive wrapper
- [ ] Keep in `new.ts`: argument parsing (`process.argv`), prompt validation, database connection check, project initialization check, agent selection with interactive `promptSingleSelect` fallback, pre-flight check, context assembly display, slug generation via `generateSlugFromAgent()`, and all user-facing console output (dividers, step/ok/fail messages, timing display)
- [ ] Remove from `new.ts`: the duplicated pipeline logic (PM agent dispatch, EM agent dispatch, EM loop invocation, post-mortem agent dispatch, file cleanup, worktree setup/teardown, PR creation) — all of which is already in `runNewTaskProgrammatic()`
- [ ] Have `new.ts` call `runNewTaskProgrammatic()` with the resolved parameters (prompt, projectId, projectRootPath, slug, agent) and handle the result with appropriate CLI output
- [ ] Ensure `new.ts` still calls `process.exit()` on failure and `sql.end()` before exiting — `runNewTaskProgrammatic()` does NOT call these
- [ ] Preserve the PR description prefix as `murder new: <slug>` (vs `murder job: <slug>` used by the job executor) — if `runNewTaskProgrammatic()` hardcodes the PR title, add a `prTitlePrefix` option or similar

### Validate
- [ ] Run `npx tsc --noEmit` and fix any type errors
- [ ] Verify that `web/app/routes/jobs.tsx` still has its own local `slugify()` (it should NOT import from `src/lib/` — it's client-side React code)
- [ ] Confirm no new files were created other than `src/lib/cli-utils.ts`
