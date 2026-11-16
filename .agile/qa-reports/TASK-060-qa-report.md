# QA Report: TASK-060 — `PATCH /v1/creator/timezone`

**Result: PASS** (2026-11-16)

- Route is `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('CREATOR')` in the creator controller; the body is validated by the contract schema and the write goes through `ProfileService.updateOwnTimezone`; `ProfileAccountNotActiveError` maps to 401 `UNAUTHENTICATED`. `no-store` applies through the `/v1/creator` prefix.
- 10 integration tests (`creator-timezone.int.spec.ts`): every allowed zone saves and appears on `/v1/me` and `/v1/creator/settings`; new accounts start on `Asia/Jakarta`; invalid values (`Asia/Tokyo`, `UTC`, empty, number, null, wrong case, an SQL-looking string, `{}` and no body) give 400 `VALIDATION_FAILED` and the stored value is unchanged; `id`, `user_id`, `role`, `status`, `display_name`, `bio` in the body are ignored and no other column changes (session_version too); one creator never changes another (IDOR); the same value twice is idempotent; USER gets 403 `FORBIDDEN_ROLE` with nothing written; no / garbage / admin token get 401; a blocked account, a blocked creators row and a stale `session_version` get 401 and nothing is written; `/v1/creator/profile` ignores a `timezone` key.
- Checks: api 141 tests pass; typecheck and lint pass.
