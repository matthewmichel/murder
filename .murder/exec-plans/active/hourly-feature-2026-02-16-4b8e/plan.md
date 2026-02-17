# Execution Plan: Remove Vercel AI SDK and Direct Model Calling

## Overview
Remove the `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai` packages and all code that calls AI APIs directly. The stuck detection system in `heartbeat.ts` will be simplified from a three-tier model (regex → AI diagnosis → escalate) to a two-tier model (regex → escalate), and the now-unused `diagnosis.ts` and `ai.ts` modules will be deleted.

## Phase 1: Remove AI diagnosis from heartbeat and delete unused modules
> The EM will review the engineer's work after this phase before proceeding.

### Update heartbeat.ts to remove AI diagnosis
- [ ] Remove the `import { diagnoseOutput } from "./diagnosis.js";` line from `src/lib/heartbeat.ts`
- [ ] Remove the `aiCheckDone` state variable declaration (`let aiCheckDone = false;`) and all references to it (the reset in the new-output block: `aiCheckDone = false;`)
- [ ] Remove the entire "Phase 2: AI diagnosis" block (lines 322-359 in current file) — the `if (!aiCheckDone)` block that calls `diagnoseOutput()` and its catch fallback
- [ ] After the pattern-matching block, when regex patterns don't match and silence exceeds `outputTimeoutMs * 2`, keep the existing escalation path that calls `handleStuckAction("escalate", ...)` with the log duration message — this is already correct and remains as the fallback
- [ ] Verify the resulting logic flow is: check silence → pattern match → if no match and silence > 2x timeout → escalate

### Delete unused source files
- [ ] Delete `src/lib/diagnosis.ts` entirely
- [ ] Delete `src/lib/ai.ts` entirely

### Remove npm packages
- [ ] Remove `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai` from the `dependencies` section of `package.json`
- [ ] Run `pnpm install` to update `pnpm-lock.yaml`

## Phase 2: Update documentation and validate
> The EM will review the engineer's work after this phase before proceeding.

### Update FUTURE.md
- [ ] Remove the "Remove Vercel AI SDK and direct model calling" bullet from the Near-Term Priorities section in `.murder/FUTURE.md`
- [ ] Remove the `(3) ai + @ai-sdk/anthropic + @ai-sdk/openai + src/lib/diagnosis.ts + src/lib/ai.ts (replace stuck detection with regex-only)` sub-item from the "Incremental dependency removal" bullet in the Engineering Improvements section of `.murder/FUTURE.md`

### Update AGENTS.md
- [ ] Remove `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai` from the Tech Stack table's "AI SDK" row in `AGENTS.md` (the row can be removed entirely since no AI SDK remains)
- [ ] Remove the `ai.ts` and `diagnosis.ts` entries from the Directory Map in `AGENTS.md`

### Update ARCHITECTURE.md
- [ ] Remove `src/lib/ai.ts ──► AI provider APIs` from the Core Data Flow diagram in `.murder/ARCHITECTURE.md`
- [ ] Remove `src/lib/diagnosis.ts (AI-powered stuck diagnosis)` from the Core Data Flow diagram in `.murder/ARCHITECTURE.md`
- [ ] Update the "AI & Providers" section under Key Modules to remove the `ai.ts` description
- [ ] Remove `diagnosis.ts` from the Key Modules section
- [ ] Update the Dependency Graph to remove `src/lib/ai.ts` and `src/lib/diagnosis.ts` entries and the `@ai-sdk/openai, @ai-sdk/anthropic, ai` dependency arrows
- [ ] Update the "Known Patterns" section: change "Three-tier stuck detection" to "Two-tier stuck detection" — remove the AI diagnosis tier description

### Typecheck validation
- [ ] Run `npx tsc --noEmit` and confirm zero errors
- [ ] Verify no files in `src/` import from `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `diagnosis.js`, or `ai.js`
