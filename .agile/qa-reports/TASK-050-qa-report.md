# QA Report: TASK-050 — `PATCH /v1/me/profile` endpoint

**Result: PASS** (2026-11-16)

- Controller is thin: `@UseGuards(UserJwtGuard, RolesGuard)` on the class, `@Roles('USER')` on the route, body through `ZodValidationPipe(UpdateProfileRequestSchema)`, service from a provider (`PROFILE` token, same pattern as `CREATOR_LINKS`). No user id in the request; the row comes from the session. `/v1/me` is already in the no-store prefixes (header asserted in a test). `roles-declared.spec.ts` still passes.
- A block that lands between guard and write maps to the same 401 as a dead session (the Mini App then re-exchanges and reports the block through the existing session-loss flow).
- 10 integration tests: save + `/v1/me` shows it; limits 40/160 accepted, 41/161/blank/missing/non-string → 400 `VALIDATION_FAILED`; `id`, `user_id`, `role`, `telegram_id`, `username`, `status`, `session_version`, `avatar_url`, `telegram_avatar_url` in the body ignored (other user untouched); two users never change each other; HTML stored as text; same save twice identical; `reset_avatar` on/off; CREATOR → 403 `FORBIDDEN_ROLE` with no write and the stale token dead after a real role change; BLOCKED account, stale `session_version`, no token, garbage and an admin token all 401 with no write.
- Full API suite 120/120 ✔, `pnpm lint` ✔, typecheck ✔.

## Notes
- No rate limit on this authenticated route (consistent with US-005; Phase H).
- No audit row for a self-service profile edit (decision in the plan).
