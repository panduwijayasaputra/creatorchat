# QA Report: TASK-055 — Creator API

**Result: PASS** (2026-11-16)

- `GET /v1/creator/settings` and `PATCH /v1/creator/profile`: `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('CREATOR')`; no id in any request; `roles-declared.spec.ts` passes. Both answer `no-store`.
- Found and fixed during QA: the no-store prefix list only had `/v1/creators`, so the new `/v1/creator/*` routes were cacheable. The prefix is now `/v1/creator` (covers both) and tests assert the header.
- 13 integration tests (`creator-settings.int.spec.ts`): own profile, code and bio link (`https://t.me/TestBot?start=c_<code>`); each creator sees only their own code; USER gets 403 `FORBIDDEN_ROLE`; a creator without a creators row gets 403 `FORBIDDEN`; no or garbage token is 401; a blocked account, a blocked creators row and a stale `session_version` are rejected with nothing written; body keys `id`, `user_id`, `creator_id`, `public_code`, `role`, `status`, `telegram_id` are ignored and another creator is untouched (IDOR); limits 40/160 and a blank bio becomes null; `reset_avatar`; the saved name and bio are visible to a USER on `GET /v1/creators/by-code/:code`; `PATCH /v1/me/profile` is still 403 for a creator.
- `GET /v1/creators/by-code` now also returns `bio`; the existing creator-link tests were updated.
- Checks: api 131 tests pass; typecheck and lint pass.
