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
