# QA Report: TASK-029 — backend-core: initData validation, rate limiter, `UserAuthService`

**Result:** PASS

## Checked
- `telegram-init-data.ts`: HMAC per Telegram's algorithm (`WebAppData` key), constant-time compare, signature checked **before** age so `expired` is only reported for really signed data, `auth_date` max age (fresh at the limit, expired one second after), small future skew allowed (60 s), strict user JSON parsing, input size cap, never throws. An independently computed HMAC vector matches. Extra signed fields (`start_param`, `signature`) stay in the check string as Telegram documents.
- `user-tokens.ts`: HS256 pinned, issuer/audience `user-api`, `typ:user`, `sv` claim. An admin token signed with the same secret, `alg:none`, HS512, a wrong type and a missing version are all rejected.
- `rate-limiter.ts`: `SET NX EX` before `INCR` (TTL always present), `peek` does not count, Redis errors become `RateLimiterUnavailableError` (callers fail closed).
- `user-auth.service.ts` (real PostgreSQL + Redis): first login creates USER/ACTIVE with the Telegram name and an https photo (non-https dropped); later logins keep edited profile fields and only refresh `telegram_username`; identity by `telegram_id`; `telegram_id` is a string in the profile; three racing first logins give one user; forged/tampered/malformed/empty data creates and changes nothing; expired data returns `expired`; BLOCKED gets no session and an audit row; audit rows hold no initData, token or bot token; per-IP limit, invalid-data limit (expired data is not counted), Redis down fails closed; `authenticate` re-reads session, status and `session_version` (revoked, expired, version bump, blocked user, another user's session, deleted session all rejected).
- `REDACT_PATHS` gained `*.init_data` and `req.body.init_data`.

## Results
- backend-core: 100 tests pass (unit + integration); typecheck, lint (0 warnings) and build pass.

## Notes
- A user-session row is written on every launch (60 min each). Cleanup is left to a later maintenance job (recorded as a plan risk).
