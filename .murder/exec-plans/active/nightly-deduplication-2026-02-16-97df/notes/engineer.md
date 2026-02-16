# Engineer Notes — Phase 1

## What was done
- Created `src/lib/cli-utils.ts` with shared exports: `step`, `ok`, `fail`, `divider`, `formatDuration`, `slugify`, `getProjectId`
- Updated 8 consumer files to import from the shared module instead of defining locally
- `slugify()` canonical version truncates to 60 chars (from `new.ts`)

## Decisions
- `cli-utils.ts` imports `sql` from `./db.js` for `getProjectId()` — no circular dependency risk since `db.ts` has zero internal imports
- `divider()` uses a pre-computed `DIVIDER_LINE` constant rather than inline string
- `init.ts` still has hardcoded divider strings in its dispatch banner section (lines ~240-250) — these are inline `console.log` calls with the `─` character repeated, not using the `divider()` function. Left as-is since they're part of a custom banner layout, not the standard divider pattern.
- `start.ts` still has inline `✓` and `✗` characters in its agent detection and final banner sections — these are direct `console.log` calls, not the `step/ok/fail` pattern. Left as-is.

## Gotchas for next phases
- Unicode characters in source files (●, ✓, ✗, ─, etc.) cause issues with string replacement tools — had to use full file writes instead of targeted replacements
- `web/app/routes/jobs.tsx` has its own `slugify()` — intentionally left separate since it's client-side React code that can't import from `src/lib/`
- `init.ts` uses `slugify` in `ensureProjectRegistered()` — now gets the 60-char truncation version, which is the safer default for branch/directory names

# Engineer Notes — Phase 2

## What was done
- Added `agent?: AgentBackend` and `prTitlePrefix?: string` to `RunNewTaskOptions` in `run-new-task.ts`
- `runNewTaskProgrammatic()` now accepts a pre-resolved agent directly (skips slug lookup when provided) and uses configurable PR title prefix (defaults to "murder job")
- Refactored `new.ts` from ~558 lines to ~305 lines — removed all duplicated pipeline logic (PM dispatch, EM dispatch, EM loop, post-mortem, file cleanup, worktree setup/teardown, PR creation)
- `new.ts` now does interactive setup (arg parsing, DB check, project check, agent selection with interactive prompt, preflight, context display, slug generation) then delegates to `runNewTaskProgrammatic()` and handles the result
- PR title prefix is "murder new" when called from CLI, "murder job" (default) when called from job executor

## Decisions
- Chose the "call and handle result" approach over `onProgress` callback — cleaner because `new.ts` does its own interactive setup with console output, then the pipeline runs silently via `runNewTaskProgrammatic()`, and `new.ts` handles success/failure output
- `runNewTaskProgrammatic()` re-runs DB check, project init check, and preflight even when called from `new.ts` — these are redundant but harmless and keep the programmatic API self-contained
- `new.ts` still calls `formatContextForPrompt(ctx)` in step 5 (for the context parts display) even though `runNewTaskProgrammatic()` will call it again internally — the return value isn't needed in `new.ts`, just the `ctx` object for listing knowledge files
- Kept `extractNameFromStreamJson`, `runQuickAgent`, and `generateSlugFromAgent` in `new.ts` — these are interactive CLI slug generation helpers not needed by the programmatic pipeline (which receives the slug as input)
- `taskStartedAt` changed from ISO string to `Date.now()` in `new.ts` since it's only used for duration calculation
