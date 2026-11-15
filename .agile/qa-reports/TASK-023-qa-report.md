# QA Report: TASK-023 — `/v1/admin/auth` API (cookies, CSRF, guard, rate limit)

**Result:** PASS

## Checked (code review)
- `AdminAuthController` is thin: validates with `AdminLoginRequestSchema`, calls `AdminAuthService`, maps outcomes to `AppError` (`INVALID_CREDENTIALS` 401 with `{attempts, max}`, `LOGIN_LOCKED` 429 with `retry_after_seconds` + `Retry-After`, `RATE_LIMITED` 429, `SERVICE_UNAVAILABLE` 503 for Redis down or unset secrets). No Prisma in controllers.
- Cookies (`admin-cookies.ts`): `cc_admin_at` HttpOnly path `/v1/admin`; `cc_admin_rt` HttpOnly path `/v1/admin/auth`; `cc_admin_csrf` readable, path `/`. Secure / SameSite / domain come from `COOKIE_*` env. Cleared with matching attributes.
- `CsrfGuard`: unsafe methods need an `Origin` in `ALLOWED_ORIGINS`, and (except login via `@SkipCsrfToken`) a constant-time-equal `X-CSRF-Token` header and cookie.
- `AdminJwtGuard`: reads only the access **cookie** (a Bearer header is ignored), so an Authorization header from another auth scheme can never authenticate an admin call. Session + admin status are re-read from the DB on every request.
- Refresh: a racing tab (old token inside the 10 s grace) gets 401 **without** cleared cookies; real reuse/unknown token clears all three cookies.
- Logout: identifies the session from the access cookie or, when that expired, the refresh cookie; 204; idempotent; clears cookies.
- All `/v1/admin/*` responses carry `Cache-Control: no-store` (onRequest hook).
- Without usable secrets the API still boots and admin auth answers 503; health stays 200.
- Test runs use their own Redis key prefix (`test:admin:login`) so they cannot touch dev lockouts.
- Small additions to shared code: `AppError` gained optional response headers; `AllExceptionsFilter` applies them.

## Results
- `pnpm --filter @creatorchat/api typecheck`, `lint`: clean. Integration: 26 new tests in `apps/api/test/admin-auth.int.spec.ts` (+3 existing) pass against real PostgreSQL + Redis; unit project 22 pass.
- Covered: cookie attributes (Secure/SameSite from env), identical wrong/unknown responses, 5-failure lock with Retry-After and rejection of the correct password while locked, validation copy, foreign/missing Origin, missing/wrong CSRF, refresh rotation + racing tab + reuse revoking the whole session, logout killing the old access and refresh cookies, disabled admin, guard on a throwaway admin controller, unknown `/v1/admin/*` → 404, no register/account routes, user-secret token and user-session token rejected, admin token rejected by a stub user guard, secrets absent from logs/audit/body.

## Notes
- Reuse after the grace window is tested by back-dating `rotated_at` in the DB (the API has no injectable clock).
- A fully wired Telegram user guard does not exist yet (US-004); the "admin token cannot call user endpoints" check uses a stub guard and must be repeated against the real user guard in US-004.
