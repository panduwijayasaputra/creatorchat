# QA Report: TASK-157 — API endpoint

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `apps/api/test/creator-inbox.int.spec.ts` (10) plus `roles-declared.spec.ts`: passed; ESLint clean for the module and the spec.
- Covered: no token 401, USER 403 `FORBIDDEN_ROLE`, blocked creator 401; creator A sees only A's rows and the raw JSON holds no customer id, Telegram id or username; strict query (`limit=0|51`, `filter=manual`, unknown key, `cursor=garbage`, empty cursor → 400); two pages via `next_cursor` cover every conversation once; `filter=unread` and `unread_conversations`; `no-store`.
