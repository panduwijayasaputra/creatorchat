# QA Report: TASK-147 — Chat contracts and error codes

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `packages/contracts` vitest: 271 passed (19 new in `chat.spec.ts`: trim, empty/whitespace, 2000 vs 2001, code points (emoji), bad id, unknown key, query defaults and bounds, error codes parse).
- `tsc --noEmit` clean; ESLint clean.
## Findings
- Fixed during dev: `HistoryQuery` / `HistoryQuerySchema` clashed with the admin creator-history contract in `index.ts`; renamed to `ChatHistoryQuery*`.
- `ChatMessage` exposes only `sender: 'ME' | 'CREATOR'`, no user ids, no mode. OK.
