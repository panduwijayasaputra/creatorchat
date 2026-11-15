# QA Report: TASK-030 — API: `POST /v1/auth/telegram`, `GET /v1/me`, `UserJwtGuard`

**Result:** PASS

## Checked
- `AuthController` (thin): validates the body with `TelegramLoginRequestSchema` (strict, `init_data` only), maps the service outcome to 200 / 401 `TELEGRAM_AUTH_INVALID` / 401 `TELEGRAM_AUTH_EXPIRED` / 403 `ACCOUNT_BLOCKED` / 429 `RATE_LIMITED` (+`Retry-After`) / 503. `MeController` returns the profile the guard loaded from the database.
- `UserJwtGuard`: reads only `Authorization: Bearer` (cookies are never accepted), re-checks session row, status and `session_version` on every request. Unconfigured (no bot token / secret) → 503 and the API still boots.
- `Cache-Control: no-store` on `/v1/auth/*` and `/v1/me`; CORS preflight allows `Authorization` for allowlisted origins.
- `apps/api/test/user-auth.int.spec.ts` (16 tests, real PostgreSQL + Redis, Redis prefix `test:user:login`): valid login (one user on repeat, `telegram_id` string), forged / tampered / expired / empty / over-posted bodies with no user created, BLOCKED → 403 and no session, per-IP limit and invalid-data limit with 429, CORS preflight, logs contain no initData, hash, token or bot token; `/me`: DB-sourced profile, missing / malformed / forged / expired / revoked tokens, `session_version` bump and block invalidate the old token, client-sent role / ids / headers ignored, cookies not accepted; admin token rejected on `/v1/me`, user token rejected by the admin API (cookie and Bearer); 503 when bot token or secret missing (health still 200); 503 when Redis is down and nothing is created.
- This closes the US-003 caveat for the user-side guard (the admin-vs-user test now uses the real `UserJwtGuard`).

## Results
- api: 69 tests pass (unit + integration); typecheck and lint pass. The existing admin-auth fixtures were adapted to the new CHECK (`sessionVersion` on user sessions).
