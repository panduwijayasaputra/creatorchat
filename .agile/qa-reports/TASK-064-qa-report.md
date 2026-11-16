# QA Report: TASK-064 — `GET` and `POST /v1/me/creator-request`

**Result: PASS** (2026-11-16)

- Both routes are `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('USER')` in `CreatorRequestController`; the caller id comes only from the session and the body is validated by the contract schema (unknown keys stripped). `CreatorRequestAccountNotActiveError` → 401 `UNAUTHENTICATED`; `CreatorRequestBlockedError` → 409 `CREATOR_REQUEST_BLOCKED` with `{creator_name, ends_at}` in `details` (no ids). `no-store` applies through the `/v1/me` prefix. The controller is thin; the service is wired through its own token in `MeModule`.
- 24 integration tests (`creator-request.int.spec.ts`, real database, real login): stored as PENDING with the link normalised, role stays USER, one audit row; `user_id` / `role` / `status` / `id` in the body ignored and another user is untouched; 10 invalid bodies give 400 `VALIDATION_FAILED` and write nothing; empty body 400; a repeat and 5 concurrent submits give one row and one id; an active subscription gives 409 with the right details and nothing changes; a future subscription blocks, ended and revoked ones do not; a new request after a rejection leaves the rejected row alone; CREATOR gets 403 `FORBIDDEN_ROLE` on both routes; no token / garbage / admin token get 401; a blocked account and a session made stale by a role change get 401 with nothing written; `GET` is empty for a fresh user, shows the latest request and the block, never leaks another user's data, and is `no-store`.
- Checks: api 165 tests pass; typecheck and `pnpm lint` pass.

## Not verified here
- Rate limiting: none added. The one-pending index bounds spam to one row per user, but a user with a rejected request can resubmit without a limit (a later story if wanted).
