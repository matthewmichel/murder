# PRD: Remove Vercel AI SDK and Direct Model Calling

## Overview

Remove the `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai` npm packages and all code that calls AI APIs directly from murder. These packages are used exclusively for AI-powered stuck detection diagnosis in `src/lib/diagnosis.ts`. The stuck detection system will fall back to regex-only pattern matching via `src/lib/patterns.ts`, which already serves as the first-pass detection layer. This simplifies the architecture, removes three dependencies, and aligns with murder's agent-first direction where all AI work goes through agent backends.

## Goals

- Remove the `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai` packages from `package.json` and the `node_modules` footprint.
- Delete `src/lib/diagnosis.ts` and `src/lib/ai.ts` entirely — no code in murder should call AI provider APIs directly.
- Update `src/lib/heartbeat.ts` to use regex-only stuck detection, removing the AI diagnosis phase from the three-tier monitoring system (regex → AI → escalate becomes regex → escalate).
- Maintain the existing conservative stuck detection behavior: when regex patterns don't match and silence persists, escalate to the user rather than killing the agent.
- Pass `npx tsc --noEmit` with zero errors after all changes.

## Non-Goals

- **Not adding new regex patterns.** The existing patterns in `src/lib/patterns.ts` are sufficient. Pattern tuning is a separate future task.
- **Not changing stuck detection timeout thresholds.** The current thresholds (30s default, 120s for learn/new, 300s for engineer phases) remain as-is. Tuning is a separate item in FUTURE.md.
- **Not removing `zod`.** Even though `zod` may be unused, it's out of scope for this change. The FUTURE.md item on incremental dependency removal treats each removal as a separate PR.
- **Not removing `mem0ai`, `@modelcontextprotocol/sdk`, or `src/mcp/`.** Those are separate FUTURE.md items.
- **Not modifying the web UI.** The web UI does not import from `ai.ts` or `diagnosis.ts`.

## User Stories

- As a developer running `murder new`, I want stuck detection to work without requiring an AI provider config for orchestration, so that the monitoring system is simpler and doesn't fail when no orchestration model is configured.
- As a developer maintaining murder, I want fewer dependencies to manage so that upgrades, audits, and install times are reduced.
- As a contributor reading the codebase, I want the architecture to clearly reflect the agent-first direction — no code paths that call AI APIs directly — so the design intent is unambiguous.

## Technical Considerations

### Modules touched

- **`src/lib/heartbeat.ts`** — Remove the import of `diagnoseOutput` from `diagnosis.js`. Remove the "Phase 2: AI diagnosis" block in `monitorTask()`. When regex patterns don't match and silence exceeds the timeout, escalate directly to the user (the existing `silenceMs > outputTimeoutMs * 2` escalation path). The `aiCheckDone` state variable becomes unnecessary.
- **`src/lib/diagnosis.ts`** — Delete this file entirely.
- **`src/lib/ai.ts`** — Delete this file entirely. Its exports (`resolveConfig`, `getLanguageModel`, `getEmbeddingModel`) are only consumed by `diagnosis.ts`.
- **`package.json`** — Remove `ai`, `@ai-sdk/anthropic`, and `@ai-sdk/openai` from `dependencies`.

### Modules NOT touched

- `src/lib/patterns.ts` — No changes needed. It already works independently.
- `src/lib/providers.ts` — Manages provider CRUD and encrypted keys in the database. Not affected; providers are still needed for agent backend model selection.
- `src/lib/crypto.ts` — Only imported by `ai.ts` for key decryption, but also used by `providers.ts` and the web UI. Not affected.
- `web/` — The web UI has its own `db.server.ts` and `crypto.server.ts` and does not import from `src/lib/ai.ts` or `src/lib/diagnosis.ts`.

### Database changes

None. The `ai_configs`, `ai_providers`, and `ai_provider_keys` tables remain — they're used by `murder setup` and the provider management system. The orchestration config stored there is used to select the Cursor CLI model, not for direct API calls.

### API changes

None. This is an internal refactor with no user-facing command changes.

### Patterns to follow

- ESM imports with `.js` extensions.
- Section separator comments (`// ---------------------------------------------------------------------------`).
- Conservative stuck detection — prefer "continue" or "escalate" over "kill".
- `process.exit(1)` for fatal errors, try/catch at command boundaries.
- Run `npx tsc --noEmit` to validate.

## Acceptance Criteria

1. `src/lib/diagnosis.ts` does not exist.
2. `src/lib/ai.ts` does not exist.
3. `package.json` does not list `ai`, `@ai-sdk/anthropic`, or `@ai-sdk/openai` in any dependency section.
4. `src/lib/heartbeat.ts` does not import from `diagnosis.js` or `ai.js`.
5. `src/lib/heartbeat.ts` still performs regex-based stuck detection via `matchStuckPattern()`.
6. When regex patterns don't match and silence persists, `monitorTask()` escalates to the user with log path and PID information (existing behavior preserved).
7. `npx tsc --noEmit` passes with zero errors.
8. No other files in `src/` import from `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `diagnosis.js`, or `ai.js`.
9. The `FUTURE.md` file is updated to remove this item from Near-Term Priorities.

## Edge Cases & Risks

- **Catch block in heartbeat becomes dead code.** The current `monitorTask()` has a catch block around `diagnoseOutput()` that falls back to escalation when AI diagnosis fails (e.g., no orchestration model configured). After removing AI diagnosis, this catch block disappears. The replacement logic must still escalate after sufficient silence — verify the escalation path works when regex patterns don't match.
- **Loss of nuanced diagnosis.** The AI diagnosis could sometimes distinguish between "agent is thinking" and "agent is stuck" better than regex. This is an accepted tradeoff — the conservative approach (escalate to human) is preferred over the risk of killing a working agent, and the AI diagnosis was itself unreliable (it contradicted the agent-first direction and required a configured orchestration model).
- **Existing `ai_configs` with `orchestration` capability.** Users who ran `murder setup` may have an orchestration config in the database. These rows become unused but harmless. No migration needed to clean them up.
- **pnpm lockfile.** After removing the three packages, `pnpm install` must be run to update `pnpm-lock.yaml`. The lockfile change should be included in the PR.
