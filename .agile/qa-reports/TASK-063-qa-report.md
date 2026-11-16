# QA Report: TASK-063 — `CreatorRequestService` (backend-core)

**Result: PASS** (2026-11-16)

- `submit(userId, input)` runs in one transaction. It first locks the caller's row (`SELECT … WHERE id, status = 'ACTIVE', role = 'USER' FOR UPDATE`); no row → `CreatorRequestAccountNotActiveError` with nothing written. Then, in order: an existing PENDING request is returned unchanged (no write, no audit); an active or future subscription (`revoked_at IS NULL AND ends_at > now`) throws `CreatorRequestBlockedError` carrying the creator name and `ends_at` of the subscription that ends last; otherwise the PENDING row and a `creator.application.submitted` audit row (type only, no link or text) are written. The user's role, status, `session_version` and every subscription are never touched.
- `getState(userId)` is scoped by the caller id (latest request by `created_at`, blocking subscription). The clock is injected, so tests are deterministic.
- 15 integration tests on the test database: happy path with audit; repeat submit returns the same row and writes no second audit; 5 concurrent submits give one row; new request after a rejection leaves the rejected row unchanged; blocked by an active subscription (nothing written, subscription unchanged); blocked by a future one; ended and revoked ones do not block; latest `ends_at` is reported; a pending request is returned even if a subscription appeared later; blocked user, CREATOR and unknown id rejected with nothing written; `getState` for a fresh user, the latest request, and no leakage to another user.
- Checks: backend-core 188 tests pass; typecheck passes; ESLint clean.

## Not verified here
- A real race between a subscription grant and a submit (the grant API does not exist until Phase C; the row lock covers the user row only, and approval re-checks inside its own transaction in US-012).
