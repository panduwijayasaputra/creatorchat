# Technical Plan: US-004 — Mini App login with Telegram and role-based landing

## Architecture Overview

Vertical slice: contracts → one small migration → `backend-core` (initData validation + `UserAuthService`) → API (`POST /v1/auth/telegram`, `GET /v1/me`, `UserJwtGuard`) → Mini App (Telegram wrapper, auth client, login screens, role landing). Brief refs: §3, §4, §15 (validate initData server-side, never log it, rate-limit login), §17. Design refs: `AuthMain` (rules), `AuthLogin`, `AuthOutside`, `AuthStates` (three states).

Decisions agreed with the user (2026-11-15):

| Topic | Decision |
|---|---|
| Session token | HS256 JWT (`jose`) held in memory, sent as `Authorization: Bearer`. 60 min, **no refresh token**. When it expires (401) or the app is reopened, the Mini App re-exchanges `initData`. Claims `sub`, `sid`, `sv` (session_version), `typ:"user"`, iss `creatorchat`, aud `user-api`, signed with `USER_SESSION_SECRET` |
| Local testing | Validation is always real (HMAC with `TELEGRAM_BOT_TOKEN`). Dev gets a signing helper: `pnpm telegram:initdata` prints a validly signed `initData` using the token from `.env`; the Mini App accepts it through `?tgdev=<initData>` **only when `import.meta.env.DEV`** (code is removed from `dist`, covered by `check-no-preview`). Tests use a fixed test bot token |
| Telegram SDK | Official `telegram-web-app.js` `<script>` in `apps/miniapp/index.html` + a thin typed wrapper in `src/telegram/`. No new npm dependency |
| Profile photo | `photo_url` is stored in `users.avatar_url` once, at account creation. Never overwritten later. The UI falls back to initials. R2 storage waits for the media phase |

Assumptions recorded by the Tech Lead (not asked; object if wrong):
- **Launch flow:** a non-sensitive flag `cc_tg_seen=1` in `localStorage` (not a token) lets returning users skip the button: first launch shows `AuthLogin` with "Lanjutkan dengan Telegram"; once they have logged in, later launches go straight to "Menghubungkan ke Telegram…" and then to the landing page. The flag is cosmetic; clearing it only shows the button again.
- **Role-based redirect only in US-004:** after login, USER lands on `/chats` and CREATOR on `/inbox`. A CREATOR can still type a USER URL (and the reverse) until US-006 enforces roles server-side and gates the shells.
- **Sessions accumulate** (one row per launch, 60 min each). Cleanup of expired rows is left to a later maintenance job; noted as a risk.

## Authorization & Data Rules

- `POST /v1/auth/telegram` is public. Identity comes **only** from the validated `initData` (`user.id`). The body carries nothing else that is trusted (no role, no user id).
- Validation (Telegram docs, "Validating data received via the Mini App"): parse the query string, build the data-check-string (all fields except `hash`, sorted, `key=value` joined by `\n`), `secret = HMAC_SHA256(key="WebAppData", message=bot_token)`, expected = `HMAC_SHA256(secret, data_check_string)` hex, compared in constant time. `auth_date` must be present, not older than `TELEGRAM_INITDATA_MAX_AGE_SECONDS` and not more than 60 s in the future. `user` must be valid JSON with a numeric `id` (parsed to `bigint`; the API returns it as a string). `signature` / `hash` handling: validate with `hash` (bot-token flow); `signature` is ignored.
- Account: `User` is found by `telegram_id`. First login creates it in one statement (`upsert`-style, unique violation retried once) with role **USER**, status ACTIVE, `display_name` from Telegram first/last name, `telegram_username`, `avatar_url` from `photo_url`. **Later logins do not overwrite profile fields** (display name, bio, avatar); only the informational `telegram_username` is refreshed.
- BLOCKED user: no session is created; response `403 ACCOUNT_BLOCKED` (message copy belongs to US-006; this story returns a generic Indonesian-neutral code and the Mini App shows the "Belum bisa masuk" panel until US-006).
- Session: a `Session` row (`user_id` set, `admin_id` null) with `session_version` = the user's current value, `expires_at` = now + 60 min. `refresh_token_hash` becomes nullable for user sessions (migration below).
- `UserJwtGuard`: reads only `Authorization: Bearer` (never cookies), verifies the JWT, then loads the live session row + user on **every** request: session not revoked/expired, `user_id` matches `sub`, user ACTIVE, `session_version` equals the user's current one. Failure → 401 `UNAUTHENTICATED`. An admin token (aud `admin-api`) fails on audience/`typ`, and a user token never authenticates admin routes (admin guard reads only the admin cookie).
- `GET /v1/me` returns the profile + role from the database. The Mini App takes the role only from this response.
- Rate limit (Redis, fail closed with 503): fixed window per IP, 20 login attempts per minute (all attempts, success or not), and a stricter counter of 5 **invalid** initData per IP per minute. Keys never contain initData; tests use the Redis prefix `test:user:login`.
- Logging: the existing pino redaction stays; add `init_data`, `initData`, `authorization` body/header paths to `REDACT_PATHS` if missing. The API never logs the request body for this route. Tests assert neither the raw initData nor the bot token appears in captured logs.
- Audit (`AuditLog`): `user.account.created` (actor system→user id), `user.login.blocked` (user id). No audit for ordinary success or for invalid signatures (rate-limited, high volume). No raw initData/tokens in audit rows.
- Idempotency/concurrency: two simultaneous first logins for one `telegram_id` end with one `User` row (unique constraint + conflict retry); both get sessions.
- Errors reuse the existing `{code, message, request_id}` envelope. New codes: `TELEGRAM_AUTH_INVALID` (401), `TELEGRAM_AUTH_EXPIRED` (401), `ACCOUNT_BLOCKED` (403).

## Dependencies

- Packages: nothing new. `jose` 6.2.17 is already in `backend-core`; `@fastify/cookie` untouched. The Telegram script is loaded from `https://telegram.org/js/telegram-web-app.js` (official).
- Env (all already in `.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_INITDATA_MAX_AGE_SECONDS`, `USER_SESSION_SECRET` (new requirement: ≥ 32 chars and different from the admin secrets, enforced in production by the existing schema; in dev, unset/short → login answers 503 while the API boots). Client: `VITE_API_BASE_URL`, `VITE_TELEGRAM_BOT_USERNAME` (apps/miniapp `.env.example`). The local `.env` gets a generated `USER_SESSION_SECRET` and a **fake** bot token for dev signing (clearly not a real bot token) if the user has none.
- Prior stories: US-001 (User/Session tables, API foundations), US-002 (Mini App shells, shared UI, visual harness), US-003 (jose pattern, limiter pattern).
- CORS: the Mini App is a different origin from the API, so `Authorization` must be an allowed header and the Mini App origin must be in `ALLOWED_ORIGINS` (check `app.factory.ts`).

## Risks

- **Real Telegram not testable here.** The validator is verified against the algorithm in Telegram's docs with signed fixtures (including one vector computed independently in the test with `node:crypto`); full in-Telegram behaviour (WebView, `ready()`, theme) needs a bot + HTTPS tunnel and is a UAT input. Report this plainly; do not call the fake-initData path "Telegram integration".
- Bot token missing → login 503 and the Mini App shows "Belum bisa masuk"; the API still boots.
- Session rows pile up (one per launch). Acceptable for the pilot; a cleanup job comes later.
- `photo_url` is hot-linked from Telegram's CDN and may expire; UI must handle a broken image (initials).
- "Syarat Layanan" / "Kebijakan Privasi" pages are not designed (gap): the links render as in the board but point to nothing yet (`href="#"` disabled with no navigation) and are reported as a gap — no pages invented.
- Blocked-account message is a US-006 gap; US-004 only guarantees no session is issued.
- Role redirect is client-side only until US-006; do not treat it as access control.

## Tasks

### TASK-027: Contracts — Telegram login, `/me`, error codes

Add `packages/contracts/src/user-auth.ts` and export it from `index.ts`:
- Constants: `USER_API_PREFIX = '/v1'`, `USER_AUTH_PATH = '/v1/auth'`, `USER_SESSION_TTL_SECONDS = 3600`, `TELEGRAM_SEEN_FLAG = 'cc_tg_seen'`.
- `TelegramLoginRequestSchema = z.object({ init_data: z.string().min(1).max(4096) }).strict()`.
- `UserProfileSchema` (strict): `{ id: uuid, telegram_id: TelegramIdSchema (string), role: 'USER'|'CREATOR', status: 'ACTIVE', display_name: string, telegram_username: string|null, avatar_url: string|null }`.
- `TelegramLoginResponseSchema` (strict): `{ access_token: string, token_type: 'Bearer', expires_in: number, user: UserProfileSchema }`.
- `MeResponseSchema = UserProfileSchema`.
- `landingPathForRole(role)`: `'USER' → '/chats'`, `'CREATOR' → '/inbox'` (single source for API tests and the Mini App).
- `errors.ts`: add `TELEGRAM_AUTH_INVALID`, `TELEGRAM_AUTH_EXPIRED`, `ACCOUNT_BLOCKED`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/user-auth.ts` | schemas, constants, `landingPathForRole` |
| CREATE | `packages/contracts/src/user-auth.spec.ts` | schema + landing tests |
| MODIFY | `packages/contracts/src/errors.ts`, `errors.spec.ts` | three new codes |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:**
- Strict schemas reject extra keys (e.g. `role` in the request); `telegram_id` must be a digit string; `landingPathForRole` for both roles; new error codes present in the catalogue.

---

### TASK-028: Database — user sessions without a refresh token

Migration `20261116010000_user_session_support`:
- `sessions.refresh_token_hash` → nullable (unique index stays; Postgres allows many NULLs).
- `sessions.session_version INTEGER NULL` (the user's `session_version` when the session was issued; NULL for admin sessions).
- CHECK `sessions_credentials_chk`: `(admin_id IS NOT NULL AND refresh_token_hash IS NOT NULL) OR (user_id IS NOT NULL AND session_version IS NOT NULL)`.
Update `schema.prisma` (`refreshTokenHash String?`, `sessionVersion Int?`) and any admin-auth code that assumes a non-null hash (type fixes only). Apply with `migrate deploy` to the dev DB (never reset). Update `seed` fixtures only if they create sessions (they do not).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/20261116010000_user_session_support/migration.sql` | nullable hash, `session_version`, CHECK |
| MODIFY | `packages/db/prisma/schema.prisma` | Session fields |
| MODIFY | `packages/backend-core/src/admin-auth/admin-auth.service.ts` (types only, if needed) | nullable hash narrowing |
| CREATE | `packages/db/test/user-session.int.spec.ts` | constraint tests |

**Testing (integration, test DB):**
- A user session with a version and no hash inserts; an admin session without a hash is rejected; a session with neither user nor admin, or with both, is rejected; an admin session still works end to end (the US-003 suite stays green).

---

### TASK-029: backend-core — initData validation, rate limiter, `UserAuthService`

New folder `packages/backend-core/src/user-auth/`:
- `telegram-init-data.ts`: `validateInitData(initData, botToken, now, maxAgeSeconds): TelegramInitDataResult` → `{ ok: true, user: { telegramId: bigint, firstName, lastName?, username?, photoUrl? }, authDate: Date } | { ok: false, reason: 'malformed' | 'bad_signature' | 'expired' | 'missing_user' }`. Constant-time compare (`timingSafeEqual`, length-checked). Never throws on garbage input. Also `buildSignedInitData({ botToken, user, authDate, extra? })` (for dev CLI and tests; documented as not for production use).
- `user-tokens.ts`: `signUserToken` / `verifyUserToken` (jose, HS256 pinned, iss `creatorchat`, aud `user-api`, `typ:"user"`, claims `sub`, `sid`, `sv`).
- `rate-limiter.ts`: `FixedWindowLimiter(redis, prefix)` with `hit(key, limit, windowSeconds)` → `{ allowed, retryAfterSeconds }` using `SET NX EX` + `INCR` (never a key without TTL); Redis errors → `RateLimiterUnavailableError`.
- `user-auth.service.ts`: `UserAuthService` with
  - `loginWithTelegram({ initData, ip }): Promise<LoginResult>` where `LoginResult` = `{ kind: 'ok', accessToken, expiresIn, user } | { kind: 'invalid' } | { kind: 'expired' } | { kind: 'blocked' } | { kind: 'rate_limited', retryAfterSeconds }`. Order: rate-limit → validate → find/create user (transaction; unique-violation retry once) → block check → create session (`session_version` = user's) → sign token → audit (`user.account.created`, `user.login.blocked`).
  - `authenticate(token): Promise<AuthenticatedUser | null>` (token, session row, user ACTIVE, `session_version` match, all re-read from the DB).
  - `isUserAuthConfigured(env)` (bot token + secret ≥ 32 chars).
- `toUserProfile(user)` mapper (bigint → string).
- Export everything from `index.ts`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/user-auth/telegram-init-data.ts` (+ `.spec.ts`) | validator + signer |
| CREATE | `packages/backend-core/src/user-auth/user-tokens.ts` (+ `.spec.ts`) | JWT helpers |
| CREATE | `packages/backend-core/src/user-auth/rate-limiter.ts` (+ `.spec.ts`) | fixed-window limiter (fake Redis) |
| CREATE | `packages/backend-core/src/user-auth/user-auth.service.ts` (+ `.int.spec.ts`) | login + authenticate |
| MODIFY | `packages/backend-core/src/index.ts`, `config/env.ts` (REDACT_PATHS additions only) | exports, redaction |

**Testing:**
- Validator: valid payload; tampered field; tampered hash; wrong bot token; missing hash; missing/garbled `user`; `auth_date` too old, exactly at the limit, slightly in the future, far in the future; an independently computed HMAC vector; huge/garbage inputs do not throw.
- Token: wrong secret, wrong audience (an admin-style token), `alg:none`, expired, wrong `typ`.
- Service (real DB + Redis prefix `test:user:login`): first login creates USER/ACTIVE with Telegram name and photo; second login keeps edited display name/bio/avatar; username change refreshes only `telegram_username`; identity by `telegram_id` (same id, different username → same row); `telegram_id` returned as a string; BLOCKED → `blocked`, no session row, audit row; two concurrent first logins → one user; invalid/expired → no user created or changed; `authenticate` fails after `sessions.revoked_at`, after `session_version` bump, for a BLOCKED user, for an expired session, for a session of another user; rate limit allows N then blocks, Redis down fails closed; no raw initData/token/bot token in audit rows.

---

### TASK-030: API — `POST /v1/auth/telegram`, `GET /v1/me`, `UserJwtGuard`

In `apps/api/src/`:
- `common/auth/user-jwt.guard.ts`: `UserJwtGuard` (Bearer only), `CurrentUser` decorator, `request-user.ts` type augmentation, `USER_AUTH` provider token. Unconfigured → 503 `SERVICE_UNAVAILABLE`.
- `modules/auth/auth.module.ts`, `auth.controller.ts`: `POST /v1/auth/telegram` (public; validates body with `TelegramLoginRequestSchema`; maps `LoginResult` → 200 `TelegramLoginResponse` / 401 `TELEGRAM_AUTH_INVALID` / 401 `TELEGRAM_AUTH_EXPIRED` / 403 `ACCOUNT_BLOCKED` / 429 `RATE_LIMITED` with `Retry-After` / 503). `modules/me/me.controller.ts`: `GET /v1/me` (`@UseGuards(UserJwtGuard)`) → `MeResponse` from the database.
- `Cache-Control: no-store` on `/v1/auth/*` and `/v1/me` (extend the existing hook).
- CORS: confirm `Authorization` and `Content-Type` are allowed for origins in `ALLOWED_ORIGINS`; add if missing.
- Redis limiter prefix `test:user:login` when `NODE_ENV=test`.
- No request body logging for the route; verify with a captured log stream.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/common/auth/user-jwt.guard.ts`, `request-user.ts` | guard + decorator |
| CREATE | `apps/api/src/modules/auth/auth.module.ts`, `auth.controller.ts` | login endpoint |
| CREATE | `apps/api/src/modules/me/me.module.ts`, `me.controller.ts` | `/v1/me` |
| MODIFY | `apps/api/src/app.module.ts`, `app.factory.ts` | wiring, no-store, CORS headers |
| CREATE | `apps/api/test/user-auth.int.spec.ts` | HTTP integration tests |

**Testing (real DB + Redis, Fastify inject):**
- Valid initData → 200, token verifies, `/me` returns the profile; the same call twice → one user, `telegram_id` is a string.
- Forged hash, tampered payload, expired `auth_date`, empty `init_data`, extra body keys → 401/400 with the right code and **no** user created or changed.
- BLOCKED → 403 `ACCOUNT_BLOCKED`, no session row.
- `/me` without a token, with a malformed token, with an expired token, with a token for a revoked session, after `session_version` bump, and for a BLOCKED user → 401.
- Admin access token (as a Bearer) is rejected by `/me`; a user token placed in the admin cookie is rejected by `/v1/admin/auth/me`. (This closes the US-003 caveat; the user guard is now real.)
- A body/query/header with `role`, `user_id` or `telegram_id` is ignored by `/me`.
- Rate limit returns 429 with `Retry-After`; Redis down → 503. Captured logs contain neither the initData nor the bot token. Bot token or secret unset → login 503 while `/v1/health` still answers.

---

### TASK-031: Mini App — Telegram wrapper, auth client, `AuthProvider`, route guard, role landing

In `apps/miniapp/`:
- `index.html`: official `<script src="https://telegram.org/js/telegram-web-app.js">` before the app script.
- `src/telegram/webapp.ts`: typed minimal `TelegramWebApp` interface, `getInitData(): string | null` (empty string → `null`), `signalReady()` (`ready()` + `expand()` when present), bot link `botUrl(username)`. Dev-only (`import.meta.env.DEV`): `?tgdev=<initData>` overrides `getInitData`, kept in a separate file `telegram/dev-init-data.ts` imported dynamically so it is absent from `dist`.
- `src/auth/api-client.ts`: `createMiniappApi({ baseUrl, fetch })` with `loginWithTelegram(initData)`, `me(token)`; `ApiError` vs `NetworkError`; responses parsed with the contracts schemas; token held only in memory by the provider (no storage).
- `src/auth/AuthProvider.tsx`: state `{ status: 'connecting' } | { status: 'login-required' } | { status: 'outside-telegram' } | { status: 'authenticated', user } | { status: 'error', kind: 'network' | 'expired' | 'blocked' | 'unavailable' }`. Flow: no initData → `outside-telegram`; initData + no `cc_tg_seen` → `login-required` (button); otherwise (or after the button) `connecting` → login → `/me` (role from `/me`, not from the login body) → `authenticated`. Sets `cc_tg_seen=1` after the first success. `retry()` re-runs. A 401 from later calls triggers one silent re-exchange of `initData`; if that returns `expired` the state becomes `error/expired`.
- `src/auth/guards.tsx`: `RequireSession` wraps the shells and renders the matching state screen (TASK-032) for non-authenticated states; `LandingRedirect` for `/` and `/login` sends to `landingPathForRole(user.role)`.
- `src/app/routes.tsx`: `createMiniappRoutes({ api?, extraRoutes? })` wraps the shells in `RequireSession`; `/` → `LandingRedirect`. `/__preview` stays outside auth (dev only).
- `src/main.tsx`: builds the API client from `VITE_API_BASE_URL`; `apps/miniapp/.env.example` documents `VITE_API_BASE_URL` and `VITE_TELEGRAM_BOT_USERNAME`.
- Tests use a fake API (`test/fake-miniapp-api.ts`) and fake `window.Telegram`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/index.html` | official Telegram script |
| CREATE | `apps/miniapp/src/telegram/webapp.ts`, `dev-init-data.ts` (+ specs) | wrapper, dev injection |
| CREATE | `apps/miniapp/src/auth/api-client.ts`, `AuthProvider.tsx`, `guards.tsx` (+ specs) | client, state, guards |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `main.tsx`, `router.spec.tsx` | wiring, landing |
| CREATE | `apps/miniapp/test/fake-miniapp-api.ts` | test double |
| CREATE | `apps/miniapp/.env.example` | client env (public values only) |

**Testing:**
- No initData → `outside-telegram`; first launch → `login-required`; returning launch auto-connects; success → USER at `/chats`, CREATOR at `/inbox` (role taken from `/me` even when the login body says otherwise); network error → `error/network` then retry succeeds; `TELEGRAM_AUTH_EXPIRED` → `error/expired`; `ACCOUNT_BLOCKED` → `error/blocked`; 401 on a later call triggers one re-exchange; token never written to `localStorage`/`sessionStorage` (assert storage contents contain only `cc_tg_seen`); `?tgdev` is ignored when `DEV` is false.

---

### TASK-032: Mini App login screens — `AuthLogin`, `AuthOutside`, `AuthStates`, and visual check

Re-implement from the boards (PNG first, exact values from `AuthLogin.html`, `AuthOutside.html`, `AuthStates.html`; shared `Button`, icons; Indonesian copy verbatim; buttons never wrap):
- `src/auth/screens/LoginScreen.tsx`: hero panel (logo + three avatars), "Masuk dan mulai terhubung.", description, **"Lanjutkan dengan Telegram"** button (send icon), helper text, "Dengan melanjutkan, kamu menyetujui Syarat Layanan dan Kebijakan Privasi." The **demo strip ("DEMO · bukan fitur produk") is not built.** The terms links are inert (gap, reported).
- `src/auth/screens/OutsideScreen.tsx`: same hero, **"Buka di Telegram"** (arrow icon) linking to `https://t.me/<VITE_TELEGRAM_BOT_USERNAME>`; helper copy from `AuthOutside`. If the bot username is not configured, the button is disabled and the situation is logged as a configuration problem (no invented copy).
- `src/auth/screens/StateScreens.tsx`: "Menghubungkan ke Telegram…" (spinner), "Belum bisa masuk" (wifi icon, "Coba Lagi"), "Sesi Telegram berakhir" (clock icon, "Coba Lagi"). `error/blocked` and `error/unavailable` reuse the "Belum bisa masuk" panel with its **existing** copy (the blocked-account message is a US-006 gap).
- Visual harness: add the five captures (`AuthLogin`, `AuthOutside`, three states) at the board sizes (390×844 and the state board); stub `window.Telegram` and the API in the harness. View every sheet.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/auth/screens/LoginScreen.tsx`, `OutsideScreen.tsx`, `StateScreens.tsx`, `auth-screens.module.css` (+ specs) | board re-implementation |
| MODIFY | `packages/ui` icons if `send`, `arrow-up-right`, `wifi`, `clock`, `refresh` are missing | icons copied from the boards |
| MODIFY | `visual/specs/visual.spec.ts` | new captures |

**Testing:**
- Component tests: button label/click calls `onContinue`; outside link `href`; retry buttons call `retry`; no "DEMO" text; each state renders its heading; keyboard focus ring and `aria-live` on the connecting state.
- Playwright sheets vs boards (reviewed by eye).

---

### TASK-033: Dev tooling — `pnpm telegram:initdata`

- `scripts/telegram-initdata.ts` (run with `tsx`): `pnpm telegram:initdata [--id 123456789] [--name "Nadia"] [--username nadia] [--photo <url>] [--age-seconds 0]` prints one validly signed `initData` string, built with `buildSignedInitData` and `TELEGRAM_BOT_TOKEN` from `.env`. Refuses `NODE_ENV=production` and refuses to run when the token is unset or still a placeholder. Prints a ready-to-open dev URL hint (`http://localhost:5173/?tgdev=<urlencoded initData>`). The token itself is never printed.
- Root `package.json` script; README gets a "Try the Mini App login locally" section; `CONFIGURATION.md` documents `USER_SESSION_SECRET`, `TELEGRAM_BOT_TOKEN` (a fake local value is fine for dev signing) and the `VITE_*` values.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `scripts/telegram-initdata.ts` (+ `scripts/telegram-initdata.spec.ts`) | signing CLI |
| MODIFY | `package.json`, `README.md`, `CONFIGURATION.md`, `.env.example` | script + docs |

**Testing:**
- The CLI's output validates with `validateInitData` and the same token; refuses production and placeholder tokens; the bot token never appears in stdout.

---

### TASK-034: End-to-end verification, docs, and map

- Integration test (real listening server + HTTP): signed initData → login → `/me` → reuse of an old token after `session_version` bump → 401 → login again works.
- Wiring check with the built API (port 3100, test DB) and the Mini App dev server: `pnpm telegram:initdata` output through `POST /v1/auth/telegram`, then `/me`, plus a forged copy rejected.
- Verify `pnpm build` (the Mini App `dist` has no `tgdev` code and no preview code) and `grep` of `apps/miniapp/src` for `localStorage|sessionStorage` shows only the `cc_tg_seen` flag.
- Update `codebase-map.md` (endpoints, routes, entities, inventory, backlog), `backend.md` ("Built in US-004" block), `frontend.md` (Telegram wrapper, token-in-memory, `?tgdev`), `tech-stack.md` decisions log (user session token, local testing approach, Telegram SDK), `CLAUDE.md` current state, `README.md`.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm visual`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/test/user-auth.e2e.int.spec.ts` | real-HTTP flow |
| MODIFY | `.agile/guidelines/*.md`, `CLAUDE.md`, `README.md` | docs and map |

**Testing:**
- As listed above; report honestly that real Telegram (in-WebView) behaviour is untested here.

---
