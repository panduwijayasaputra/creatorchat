# QA Report: TASK-150 — API endpoints

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `apps/api/test/chat.int.spec.ts` (real app, PostgreSQL, Redis): 21 with `roles-declared.spec.ts` passed; full API suite 319 passed; ESLint clean.
- Covered: no token 401, CREATOR 403 `FORBIDDEN_ROLE`, blocked customer 401; the same 404 body for another customer's, unknown and non-uuid ids on GET and POST, nothing stored; 400 for empty, whitespace, 2001, missing / bad id, extra key, `limit=51|0`, `before=0|abc`, unknown query key; 201 then 200 with an identical body for a repeat, 409 for other text; 403 `CHAT_ACCESS_EXPIRED` (expired, revoked) and `CHAT_CREATOR_BLOCKED` with nothing stored and history still readable; `no-store`; no ids / `mode` / `AI` in the history body; two pages cover every message once while one is sent between them.
## Open
- **No send rate limit.** The only limiter is inline in the auth controllers, not a reusable helper (plan: skip and note). Logged for Phase H.
