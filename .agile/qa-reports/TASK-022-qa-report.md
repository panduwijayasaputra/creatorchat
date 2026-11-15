# QA Report: TASK-022 — Admin auth domain service (backend-core)

**Result:** PASS

## Checked (code review against plan, backend.md hard rules, brief §15)
- `tokens.ts`: HS256 pinned on verify (alg none and HS384 rejected), issuer/audience/`typ` checked, expiry via injected date; refresh token = 32 random bytes, stored as HMAC-SHA256 with `ADMIN_REFRESH_TOKEN_SECRET`; username fingerprint (SHA-256) is the only username-derived value in Redis keys and audit rows.
- `login-limiter.ts`: `SET NX EX` then `INCR`, so a counter can never exist without a TTL; the window starts at the first failure and does not slide; the 5th failure sets a 900 s lock; success resets username counters; IP counter (30 failures / 15 min) is separate; every Redis error becomes `LoginLimiterUnavailableError` (fails closed).
- `admin-auth.service.ts`:
  - Login order is limiter check → lookup → (real or dummy) Argon2id verify → counters/audit. A locked account never reaches hashing; the correct password is rejected while locked.
  - Unknown, wrong-password and disabled accounts produce the same outcome and the same counters (test compares the full sequences).
  - Refresh is one atomic `UPDATE ... RETURNING` (also checks admin ACTIVE, idle expiry and the 30-day cap, clamps the new expiry to the cap). Reuse outside the 10 s grace revokes the session and audits `admin.refresh.reuse_detected`; inside the grace window it returns `race` so the API can leave cookies alone.
  - `authenticate` queries with `userId: null`, matching `adminId`, not revoked, not expired, admin ACTIVE, so a token pointing at a Telegram user's session or another admin's session fails even if signed with the admin secret.
  - `logout` accepts a session id or a refresh token, only touches admin sessions, is idempotent and audits once.
  - Time comes from an injected clock for token/session expiry decisions. This deviates slightly from the plan note about DB time: all decisions run on one clock source so tests are deterministic; production passes `new Date()`.
- Audit rows hold ids, attempt numbers and a 12-char fingerprint; tests assert no password, token or raw unknown username appears in the serialized rows.
- Tweak versus plan: IP limiter counts **failures** (not every attempt) so a legitimate admin is never throttled by their own successful logins.

## Results
- Added `vitest.config.ts` (unit + integration projects) and global setup to backend-core.
- `pnpm --filter @creatorchat/backend-core typecheck`, `test`: 64 tests pass (46 new: 12 token, 8 limiter with a fake Redis, 26 service integration tests against the real PostgreSQL test DB and real Redis, including the concurrent-refresh race and Redis-down fail-closed).

## Notes / risks left for later
- The equal-time guarantee for unknown accounts is structural (same Argon2id call on both paths); there is no wall-clock timing assertion because that would be flaky.
- Admin sessions are not pruned yet (expired rows stay). Not needed for this story.
