# Engineer Notes — Phase 1

## What was done
- Removed AI diagnosis from heartbeat.ts (import, aiCheckDone state, Phase 2 block)
- Deleted src/lib/diagnosis.ts and src/lib/ai.ts
- Removed ai, @ai-sdk/anthropic, @ai-sdk/openai from package.json
- Updated FUTURE.md to remove the completed near-term priority and update the incremental dependency removal bullet
- pnpm install ran clean, tsc --noEmit passes with zero errors

## Decisions
- The "Phase 1: Pattern matching" comment was kept as-is since it's still accurate (it's the first phase of stuck detection)
- The escalation comment was updated from "If AI already checked..." to "No pattern match — if silence persists..." to reflect the new flow

## Gotchas for next phases
- The `openai` package is still in the lockfile as a transitive dep of `mem0ai` — that's expected and not our concern
- The `ai_configs` table and provider management code remain untouched — they're still used for agent backend model selection via `murder setup`
- The `StuckAction` type is still exported from patterns.ts and used by heartbeat.ts — no changes needed there

# Engineer Notes — Phase 2

## What was done
- FUTURE.md was already updated in Phase 1 (both the near-term priority removal and the incremental dependency removal sub-item) — no changes needed
- Removed the "AI SDK" row from AGENTS.md Tech Stack table
- Removed ai.ts and diagnosis.ts entries from AGENTS.md Directory Map
- Updated ARCHITECTURE.md Core Data Flow: removed ai.ts and diagnosis.ts arrows
- Updated ARCHITECTURE.md Key Modules: removed ai.ts description from "AI & Providers", removed diagnosis.ts entry, updated heartbeat.ts description
- Updated ARCHITECTURE.md Dependency Graph: removed ai.ts, diagnosis.ts, and @ai-sdk/* dependency arrows
- Updated ARCHITECTURE.md Known Patterns: "Three-tier stuck detection" → "Two-tier stuck detection"
- tsc --noEmit passes with zero errors
- Verified no src/ files import from ai, @ai-sdk/*, diagnosis.js, or ai.js

## Notes for future phases
- All documentation now consistently reflects the two-tier stuck detection model (regex → escalate)
- The AGENTS.md in the workspace root (outside .murder/) is a workspace rule file and was not modified — only the worktree copy was updated
