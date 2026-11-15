# QA Report: TASK-024 — Admin app auth client, AuthProvider, route guard, logout wiring

**Result:** PASS

## Checked (code review)
- `auth/api-client.ts`: relative URLs (`/v1/admin/...`, same-origin; Vite proxies `/v1` to the API in dev), `credentials: 'same-origin'`, CSRF header read from the readable `cc_admin_csrf` cookie on unsafe methods only, network failures become `NetworkError`, error bodies parsed with `ErrorResponseSchema`, one single-flight refresh on 401 with a second try that covers a racing tab, one retry of the original request, never a loop. Login and logout do not refresh and wrong credentials never count as a lost session. Tokens are never visible to JS (HttpOnly cookies); nothing touches web storage (tested).
- `auth/AuthProvider.tsx`: in-memory `{loading | authenticated | anonymous}`, `me()` on every load, `onSessionLost` flips to anonymous, `login` / `logout` throw to the caller (the page and the dialog own their messages).
- `auth/guards.tsx`: `RequireAdmin` renders nothing while loading, redirects anonymous visitors to `/login` with `from`; `RedirectIfAuthenticated` redirects a signed-in admin away from `/login`; a `from` that points at `/login` is ignored.
- `app/routes.tsx`: `/login` public; the shell and every placeholder route sit behind `RequireAdmin`; the topbar identity is the real admin (`username`, role "Administrator") and `onLogout` is the real API call. The dev-only preview stays outside auth. `createAdminRoutes` now takes an injectable `api` (the previous `admin`/`onLogout` options were placeholders and are removed).
- `vite.config.ts`: `/v1` proxy to `http://127.0.0.1:${API_PORT}` (read from the repo-root `.env` by Vite's `loadEnv`; nothing from it reaches the browser bundle). Origin is passed through unchanged, so the API's Origin check sees `http://localhost:5174`.
- A temporary `LoginPage` stub (heading "Masuk") exists only so the routes compile; TASK-025 replaces it.

## Results
- `pnpm --filter @creatorchat/admin typecheck`, `build`, repo `lint`: clean.
- `pnpm --filter @creatorchat/admin test`: 56 tests pass (23 new): client (13: CSRF header rules, wrong credentials, network failure, refresh + retry, single-flight, race retry, denied refresh, server-error refresh, no loop, logout, non-contract error body, no storage writes) and routes/logout (10: deep link redirect with `from`, no shell while loading, unreachable server, identity, `/login` redirect, lost session, double-click logout = one request, failure keeps the dialog open with its message, no storage). The existing 20 shell tests were adapted to a signed-in fake API.

## Notes
- The admin bundle now exceeds Vite's 500 kB warning because Zod arrives with `@creatorchat/contracts`. It is a warning only; code-splitting can wait until the bundle matters.
- `HealthStatus` still calls the API directly at `VITE_API_BASE_URL` (unauthenticated endpoint, CORS allowlist), which is independent of the auth proxy.
