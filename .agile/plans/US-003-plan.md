# Technical Plan: US-003 — Admin login, session, and logout

## Architecture Overview

Vertical slice, agreed with the user on 2026-11-15:

contracts → migration → backend-core service → `/v1/admin/auth` API → admin client/AuthProvider → `/login` page.

Decisions (user, 2026-11-15; recorded in `tech-stack.md`):

| Topic | Decision |
|-------|----------|
| Lockout storage | **Redis**, per normalized username (+ a separate per-IP limiter). Unknown usernames are counted the same way so existence is never revealed |
| Access token library | **jose 6.2.17** (HS256, algorithm pinned on verify). Verify the version against npm/docs before install |
| Dev topology + CSRF | Admin Vite dev server **proxies `/v1` → API** (same-origin, host-only cookies). CSRF = Origin allowlist check + **double-submit** `X-CSRF-Token` |
| Admin data layer | Small **fetch client + `AuthProvider`**. TanStack Query is still deferred until the first list screen |

Brief refs: §3 Admin, §11 Login/Dialog, §15, §17. Design refs: `AdmLogin` (1440×860), `AdmLoginStates` (2200×820, 4 states), `AdmLogoutDlg` (dialog already built in US-002).

### Token and cookie model

- **Access token:** JWT HS256 signed with `ADMIN_ACCESS_TOKEN_SECRET`, TTL **15 min**, claims `{sub: adminId, sid: sessionId, typ: "admin", iat, exp}`; `iss`/`aud` fixed (`creatorchat`/`admin-api`). The user-session secret is a different key, so a Telegram session token can never verify as an admin token.
- **Refresh token:** 32 random bytes (base64url), opaque. Stored as `HMAC-SHA256(ADMIN_REFRESH_TOKEN_SECRET, token)` hex in `sessions.refresh_token_hash` (this refines the US-001 "SHA-256" comment: the HMAC adds a server-side pepper). Idle TTL **7 days**, rotated on every refresh, absolute cap **30 days** from `created_at`.
- **Rotation + reuse detection:** on refresh, the old hash moves to `previous_refresh_token_hash` + `rotated_at`, a new hash replaces it. Presenting the previous token **after a 10 s grace** → revoke the session (`REFRESH_REUSE_DETECTED` audit). Inside the grace window (two tabs racing) → plain 401 without revoking; the client retries once with the fresh shared cookie.
- **Every `/v1/admin/*` request** (guard) verifies the JWT and loads the session row (`revoked_at IS NULL`, `expires_at > now()`, `admin_id = sub`) and the admin (`status = ACTIVE`). This is what makes "later requests with old tokens get 401" true right after logout or disabling.
- **Cookies** (HttpOnly except CSRF; `Secure` from `COOKIE_SECURE`; `SameSite` from `COOKIE_SAMESITE`, default `lax`; domain from `COOKIE_DOMAIN`):
  | Name | Path | HttpOnly | Content |
  |------|------|----------|---------|
  | `cc_admin_at` | `/v1/admin` | yes | access JWT |
  | `cc_admin_rt` | `/v1/admin/auth` | yes | refresh token |
  | `cc_admin_csrf` | `/` | **no** | random 32 bytes; client echoes it in `X-CSRF-Token` |
- **CSRF:** every non-GET/HEAD request under `/v1/admin` must (a) carry an `Origin` that is in `ALLOWED_ORIGINS`, and (b) for all routes except `POST /auth/login`, have `X-CSRF-Token` equal (constant-time) to the `cc_admin_csrf` cookie. Login is protected by (a) + `SameSite` + JSON-only content type (pre-session login-CSRF has no session to ride on). The CSRF cookie is (re)issued on login and refresh and cleared on logout.
- Nothing is stored in `localStorage`/`sessionStorage`. The client holds only `{status, admin}` in memory.

### Lockout and rate limiting (Redis)

- Key `admin:login:fail:<sha256(normalized username)>`: `INCR`; on first failure set `EXPIRE 900`. At count ≥ 5 set `admin:login:lock:<hash>` with TTL 900 s. While locked, **even the correct password is rejected** (no argon2 work, same 429 response). Success deletes both keys.
- Failure response: `401 INVALID_CREDENTIALS` with `details: {attempts: N, max: 5}`; the 5th failure and later requests return `429 LOGIN_LOCKED` with `details: {retry_after_seconds}` + `Retry-After` header.
- Unknown username and wrong password return the identical body. A dummy Argon2id verify runs for unknown/disabled accounts to equalize timing.
- Separate IP limiter (`admin:login:ip:<ip>`, 30 attempts / 15 min → `429 RATE_LIMITED`) so one source can't enumerate many usernames. `trustProxy` stays false (no deployment yet).
- Username-keyed lockout lets a stranger lock a known admin for 15 min. Accepted for MVP (brief wants lockout); the IP limiter bounds it. Recorded as a risk.
- If Redis is down, login fails closed with `503 SERVICE_UNAVAILABLE` (no unlimited guessing).

## Authorization & Data Rules

- `/v1/admin/auth/login`, `refresh` are the only unauthenticated admin routes; `logout` identifies the session from a valid access token **or**, if that expired, the refresh cookie, so an admin with an expired access token can still log out. `logout` is idempotent (204).
- `AdminJwtGuard` is the only guard on the admin module. It rejects: missing/expired/forged token, wrong `typ`/`iss`/`aud`, a `sid` whose `sessions` row has `user_id` set, revoked/expired session, disabled admin. A Telegram-user token (different secret) and a session row belonging to a user can never pass.
- Admin tokens cannot call user endpoints: user endpoints (US-004) will use a different guard and secret; this story adds a test with a stub user-guarded route proving an admin token is rejected.
- Identity comes only from the session: the `GET /v1/admin/auth/me` response is built from the DB admin row, never from the JWT claims.
- Responses never return `password_hash`, token hashes, or session internals. `me` returns `{id, username, role: "Administrator"}`. There is no display-name column; the shell shows the username (the board's "Admin Nadia" was sample data).
- Audit (`AuditLog`, actor ADMIN or SYSTEM, `request_id`, no passwords/tokens/raw username for unknown accounts): `admin.login.succeeded`, `admin.login.failed` (`changes: {attempt, usernameHash}`), `admin.login.locked`, `admin.logout`, `admin.refresh.reuse_detected`, `admin.password.reset`. Writes are best-effort inside the same transaction as session writes where one exists.
- Password hashing: parameters/functions in `packages/db/seed/admin.ts` move to `packages/backend-core` (`admin-auth/password.ts`) and the seed imports them from there (no duplicate `ARGON2_OPTIONS`).
- No registration route. The only ways to create an admin are the CLI and the seed.

## Dependencies

- New: `jose` (pin after checking the registry, currently 6.2.17), `@fastify/cookie` (match the version bundled with Fastify 5; verify peer range before pinning). Both only in `apps/api` (cookie parsing) / `packages/backend-core` (jose).
- Env (already declared in `ServerEnv`): `ADMIN_ACCESS_TOKEN_SECRET`, `ADMIN_REFRESH_TOKEN_SECRET`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`, `ALLOWED_ORIGINS` (must include `http://localhost:5174`). If either admin secret is unset or < 32 chars, admin-auth routes return `503` (the app still boots, so US-001 health keeps working); production already requires them. The dev `.env` needs generated values (the dev agent generates them locally without printing them).
- Prior stories: US-001 (schema, redis, errors, validation pipe), US-002 (shell, `ConfirmDialog`, `PasswordInput`, `Button`, `Field`).

## Risks

| Risk | Mitigation |
|------|------------|
| Username-keyed lockout can be abused to lock a real admin | IP limiter; 15 min only; audit events; documented |
| Two tabs refresh concurrently and trip reuse detection | 10 s grace; client single-flight + one retry |
| Cookie scoping mistakes (paths) leak the refresh cookie to all admin routes | Path-scope `cc_admin_rt` to `/v1/admin/auth`; test asserts cookie attributes |
| Vite proxy hides a CORS/cookie problem that appears with direct calls | Origin allowlist is enforced server-side in tests with an explicit `Origin` header; README notes the topology; final topology is decided at deployment |
| Login screen needs a "locked" state that no board designs | **Design gap.** Reuse the board's error panel (state 3) with the lockout facts as plain copy, flagged in the QA report for the designer; no new layout |
| Timing difference reveals whether a username exists | Dummy Argon2id verify on the not-found/disabled path; test compares that the same code path runs |
| Argon2 verify is CPU heavy and could be abused | Lockout + IP limiter run before any hashing |

## Tasks

### TASK-020: Admin auth contracts and error codes

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/admin-auth.ts` | Zod schemas and inferred types |
| MODIFY | `packages/contracts/src/errors.ts` | Add `INVALID_CREDENTIALS`, `LOGIN_LOCKED`, `CSRF_FAILED` |
| MODIFY | `packages/contracts/src/index.ts` | Export |
| CREATE | `packages/contracts/src/admin-auth.spec.ts` | Schema tests |
| MODIFY | `packages/contracts/src/errors.spec.ts` | New codes |

Shapes:
- `AdminLoginRequestSchema = {username: string trimmed 1..64, password: string 1..256}` (messages: "Username wajib diisi." / "Password wajib diisi."; the UI reuses the same strings). No complexity rules on login.
- `AdminSessionSchema` (`/me` and login response): `{admin: {id: uuid, username: string, role: "Administrator"}}`.
- `LoginFailureDetailsSchema = {attempts: int, max: 5}`; `LoginLockedDetailsSchema = {retry_after_seconds: int}`.
- Constants: `ADMIN_LOGIN_MAX_ATTEMPTS = 5`, `ADMIN_LOGIN_LOCK_SECONDS = 900`, `ADMIN_CSRF_HEADER = 'x-csrf-token'`, cookie names.
- Refresh and logout have no body.

**Testing:** valid/invalid login bodies (empty, whitespace-only, too long, extra fields stripped), `AdminSessionSchema` rejects a payload containing a hash field, error code list contains the new codes, `ErrorResponseSchema` accepts details for them.

---

### TASK-021: Session rotation migration, shared password helpers, admin CLI

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | `Session.previousRefreshTokenHash String? @unique @map("previous_refresh_token_hash")`, `rotatedAt DateTime? @map("rotated_at") @db.Timestamptz(3)` |
| CREATE | `packages/db/prisma/migrations/<ts>_admin_session_rotation/migration.sql` | Add columns + unique index |
| CREATE | `packages/backend-core/src/admin-auth/password.ts` | Move `ARGON2_OPTIONS`, `normalizeAdminUsername`, `generatePassword`, `hashPassword`, `verifyPassword`, add `verifyDummy()` |
| MODIFY | `packages/db/seed/admin.ts` (+ `seed.ts`, `run-seed.ts` if needed) | Import from backend-core or re-export without duplicating |
| CREATE | `scripts/admin-cli.ts` (or `packages/db/seed/admin-cli.ts`) | `pnpm admin:create --username <u> [--password-env VAR]`; `--reset-password` rotates the hash, revokes all that admin's sessions, writes `admin.password.reset` audit |
| MODIFY | `package.json` | `admin:create` script |
| MODIFY | `README.md`, `CONFIGURATION.md` | Document the CLI and admin secrets |

Rules: password from an env var name given by `--password-env` or generated and printed **once**; never accepted as a plain CLI argument (shell history) and never logged. Refuses to run against the test database name and prints which database it will touch. Existing username without `--reset-password` → error, no change. Check for dependency direction: `packages/db` must not become a dependency of backend-core's password module (db already depends on backend-core? verify; if it creates a cycle, keep the helpers in `packages/db/seed` and import them in backend-core instead — pick the one without a cycle and update the map).

**Testing:** int test: migration applies on the test DB, a session rotates hashes; CLI creates an admin with a supplied password (hash is Argon2id, no plaintext), generated password is 24 chars and printed once, duplicate username rejected, reset revokes sessions, uppercase/invalid usernames rejected; seed still passes.

---

### TASK-022: Admin auth domain service (backend-core)

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/admin-auth/admin-auth.service.ts` | `AdminAuthService` |
| CREATE | `packages/backend-core/src/admin-auth/tokens.ts` | jose sign/verify, refresh token generate/hash |
| CREATE | `packages/backend-core/src/admin-auth/login-limiter.ts` | Redis lockout + IP limiter (injected minimal Redis interface) |
| CREATE | `packages/backend-core/src/admin-auth/*.spec.ts`, `*.int.spec.ts` | Tests |
| MODIFY | `packages/backend-core/src/index.ts` | Export |

Service (takes Prisma client, limiter, clock, secrets; no Nest):
- `login({username, password, ip, requestId})` → `{session, accessToken, refreshToken, csrfToken}` or throws a typed result (`InvalidCredentials{attempts}`, `Locked{retryAfter}`, `RateLimited`). Order: IP limiter → lock check → fetch admin → verify (real or dummy) → on failure increment + audit → on success reset counters, create `Session` row, audit.
- `refresh({refreshToken, requestId})` → rotated tokens; transactional `UPDATE ... WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()` so two concurrent refreshes with the same token yield exactly one success. Reuse after grace → revoke + audit. Disabled admin or absolute cap exceeded → revoke, 401.
- `authenticate(accessToken)` → `{admin, session}` or null (JWT verify + DB checks above).
- `logout({sessionId | refreshToken})` → revokes, audit, idempotent.
- Time comes from injected clock / DB `now()` for expiry decisions.

**Testing (unit with fake clock + fake limiter; integration on the real test DB + Redis):**
- correct login; wrong password → attempts 1..4 then lock at 5; correct password while locked rejected; lock expires after 900 s; success resets the counter; unknown username has the same attempts/lock behaviour and the same response shape as a wrong password; disabled admin cannot log in or refresh.
- refresh: rotates; old token inside grace → rejected, session alive; old token after grace → session revoked; concurrent refresh with one token → one winner (real DB, `Promise.all`); expired/absolute-cap sessions rejected.
- access token: tampered signature, `alg: none`, wrong `typ`, wrong secret, expired → null; token signed with a different secret (simulated user-session secret) → null; session whose row has `user_id` set → null.
- logout then `authenticate` → null; logout twice → ok.
- audit rows written, and none contains the password, token, or raw unknown username (assert on JSON text).

---

### TASK-023: `/v1/admin/auth` API (cookies, CSRF, guard, rate limit)

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/package.json`, `pnpm-lock.yaml` | `@fastify/cookie` |
| MODIFY | `apps/api/src/app.factory.ts` | Register cookie plugin; add `CSRF`-relevant allowed headers to CORS (`x-csrf-token`) |
| CREATE | `apps/api/src/admin/admin.module.ts` | Admin scope module (sub-modules mount here later) |
| CREATE | `apps/api/src/admin/admin-auth/admin-auth.module.ts` | Providers: `AdminAuthService` wrapped from backend-core, limiter bound to `RedisService` |
| CREATE | `apps/api/src/admin/admin-auth/admin-auth.controller.ts` | `POST /v1/admin/auth/login`, `POST /v1/admin/auth/refresh`, `POST /v1/admin/auth/logout`, `GET /v1/admin/auth/me` |
| CREATE | `apps/api/src/common/auth/admin-jwt.guard.ts` | `AdminJwtGuard`, `@CurrentAdmin()` |
| CREATE | `apps/api/src/common/auth/csrf.guard.ts` | Origin allowlist + double-submit check |
| CREATE | `apps/api/src/admin/admin-auth/admin-cookies.ts` | Set/clear cookie helpers with the attributes in the table |
| MODIFY | `apps/api/src/app.module.ts` | Import `AdminModule` |
| CREATE | `apps/api/src/admin/admin-auth/*.int.spec.ts`, `apps/api/test/helpers.ts` additions | Tests |

Behavior:
- `login`: validated with contracts; sets 3 cookies; returns `AdminSessionSchema`; `Cache-Control: no-store` on all auth responses. Error mapping: `INVALID_CREDENTIALS` 401, `LOGIN_LOCKED` 429, `RATE_LIMITED` 429, `SERVICE_UNAVAILABLE` 503 (Redis down or secrets unset), `CSRF_FAILED` 403.
- `refresh` (cookie `cc_admin_rt`, CSRF required): rotates and re-sets cookies; 401 + clear cookies on any failure.
- `logout`: CSRF required; clears cookies always; 204.
- `me`: guarded; returns the DB admin.
- A guarded probe route (`GET /v1/admin/auth/ping` is not added; tests mount a throwaway guarded controller via `extraModules`) proves the guard on arbitrary `/v1/admin/*` routes. Unknown `/v1/admin/*` paths return 404 from the normal router, never an unauthenticated 200.
- No public registration route exists (test asserts `POST /v1/admin/auth/register` and `/v1/admin/accounts` return 404).

**Testing (integration via `buildTestApp()` + `app.inject()`):**
- login happy path: status, 3 cookies with exact attributes (HttpOnly on at/rt, not on csrf; paths; Secure/SameSite from env), body has no secrets; wrong creds body identical for unknown/known user; 5 failures → 429 + `Retry-After`; network-independent.
- CSRF: POST without header, wrong header, missing/foreign `Origin` → 403 `CSRF_FAILED`; GET allowed without header.
- Access cookie expired but refresh valid → refresh works → `me` works; refresh reuse after grace → 401 and the new token also dead.
- After logout the old access cookie and old refresh cookie → 401 on `me`/guarded probe/refresh.
- Disabled admin: existing access token → 401 on the next request; refresh → 401; login → generic failure.
- Separation: a JWT signed with `USER_SESSION_SECRET` (and a session row with `user_id`) → 401 on the guarded probe; an admin access token on a stub user-guarded route → 401; a user-style bearer header is ignored.
- Audit events exist per action with the request ID.
- Response never contains `passwordHash`, `refresh`, or token hashes; logs do not contain the password or tokens (capture log stream).

---

### TASK-024: Admin app auth client, AuthProvider, route guard, logout wiring

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/vite.config.ts` | `server.proxy['/v1'] → http://localhost:3000` (port from env default) |
| CREATE | `apps/admin/src/auth/api-client.ts` | `fetch` wrapper: `credentials: 'same-origin'`, reads `cc_admin_csrf` cookie → `X-CSRF-Token` on unsafe methods, parses error contract, single-flight refresh + one retry on 401 (except login/refresh), maps network failure to `NetworkError` |
| CREATE | `apps/admin/src/auth/AuthProvider.tsx` | State `loading | authenticated | anonymous`; on mount calls `me`; `login()`, `logout()`; in-memory only |
| CREATE | `apps/admin/src/auth/RequireAdmin.tsx`, `RedirectIfAuthenticated.tsx` | Route wrappers (redirect to `/login`, keep `from`; shell never renders for anonymous) |
| MODIFY | `apps/admin/src/app/routes.tsx` | `/login` outside the shell; shell under `RequireAdmin`; identity from `useAuth()`; `onLogout` calls the API then navigates to `/login`; keep `createAdminRoutes` options injectable for tests |
| MODIFY | `apps/admin/src/main.tsx` | Wrap with `AuthProvider` |
| CREATE | `apps/admin/src/auth/*.spec.tsx` | Tests with a stubbed `fetch` |
| MODIFY | `apps/admin/src/components/shell/AdminShell.spec.tsx`, `apps/admin/src/preview/*` | Keep green with the injected auth |

Behavior: while `loading` show a neutral blank (no flash of the shell, no login flash). Logout confirm: dialog `onConfirm` awaits the API; on failure the dialog stays open with its fixed failure message (existing `ConfirmDialog` behavior); on success state → anonymous → `/login`. A 401 from any later API call (after the refresh attempt fails) → anonymous → `/login`. Topbar identity: `admin.username` initials via `initialsOf`, role "Administrator".

**Testing:** anonymous deep link `/creators` → `/login` (and back to `/creators` after login); authenticated visit to `/login` → `/`; `me` 401 → one refresh → retry; refresh failure → `/login`; two parallel 401s trigger one refresh; unsafe requests carry the CSRF header; nothing written to `localStorage`/`sessionStorage` (spy); logout success and failure paths; double-click logout → one request.

---

### TASK-025: `/login` page (AdmLogin + AdmLoginStates) and visual check

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/pages/login/LoginPage.tsx`, `login.module.css` | Card 440 wide, logo block, "Masuk" form, notice strip |
| CREATE | `apps/admin/src/pages/login/LoginPage.spec.tsx` | Behavior tests |
| MODIFY | `apps/admin/src/preview/Preview.tsx`, `fixtures.ts` | Optional: dev-only preview of the 4 states (no leak to dist) |
| MODIFY | `visual/specs/visual.spec.ts` | Capture `/login` at 1440×860 vs `AdmLogin.png`, and the state variants vs `AdmLoginStates.png` |

Spec: copy values from `AdmLogin.html`/`AdmLoginStates.html` (card padding 32, radius 24, shadow, field height 44, button 48, error panel `#FBE3E0` radius 20, notice strip `#FBEDF2`). Reuse `Field`, `TextInput`, `PasswordInput` ("Tampilkan"), `Button` (`loading` → "Memeriksa…" with spinner, disabled, `aria-busy`), icons from `@creatorchat/ui`. Copy verbatim: "Masuk", "Gunakan username dan password admin.", "Username wajib diisi.", "Password wajib diisi.", "Username atau password salah", "Periksa kembali isian. Setelah 5 kali gagal, login dikunci 15 menit. Percobaan: N dari 5.", "Tidak bisa terhubung ke server", "Koneksi terputus. Isianmu tetap tersimpan. Coba lagi sebentar.", "Coba Lagi", "Akun admin dibuat oleh tim platform. Tidak ada pendaftaran admin publik."

States: idle; validation (both fields blank → inline errors, red border, no request); submitting (button replaced by `Memeriksa…`, second click ignored, a ref guard like `ConfirmDialog`); wrong credentials (panel above the fields, N from `details.attempts`, inputs kept); network failure (panel + button becomes "Coba Lagi" that resubmits; inputs kept); **locked (design gap)**: reuse the error panel with title "Login dikunci sementara" and body "Terlalu banyak percobaan. Coba lagi dalam N menit." (copy is not in the boards; flag for the designer). Success → navigate to `from` or `/`. No registration or "lupa password" link. Focus moves to the first invalid field / the error panel (`role="alert"`). Password is never put in the URL, logs, or storage; on failure the password field is kept (board 3 keeps it).

**Testing:** each state above, Enter key submits, "Tampilkan" toggles type and label, double-click sends one request, failed attempt counter text, locked copy, network error keeps both values, no `localStorage` writes, a11y names (labels associated, error panel announced). Visual: `pnpm visual` produces sheets for `AdmLogin` and the 4 states; review them manually; the DEMO strip is not part of the admin login board.

---

### TASK-026: End-to-end verification, docs, and map

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `README.md`, `CONFIGURATION.md`, `.env.example` | Admin secrets, `pnpm admin:create`, dev topology (proxy), first-login steps |
| MODIFY | `.agile/guidelines/backend.md`, `frontend.md`, `codebase-map.md`, `tech-stack.md` | Endpoints, routes, entities (Session columns), decisions, pinned versions (jose, @fastify/cookie) |
| CREATE | `apps/api/test/admin-auth.e2e.int.spec.ts` | One happy-path flow across login → me → refresh → logout against a real DB + Redis |

Local manual flow (documented): `pnpm db:migrate` → `pnpm admin:create --username <u>` (copy the password shown once) → `pnpm dev` → http://localhost:5174 redirects to `/login` → log in → shell → Logout → `/login`.

**Testing:** full `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; `pnpm visual` for the new login sheets; grep that no `localStorage|sessionStorage` use appears in `apps/admin/src`; build still passes `check-no-preview.mjs`.

---

## Implementation order

TASK-020 → TASK-021 → TASK-022 → TASK-023 → TASK-024 → TASK-025 → TASK-026
