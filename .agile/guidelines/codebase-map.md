# Codebase Map

> Overview of what **actually exists** in the CreatorChat repo. Keep in sync when adding entities, endpoints, routes, or design screens. Planned items are marked _planned_ until implemented.

## Current State (2026-11-15)

- **US-001 built (ready for UAT):** pnpm workspace (ESM TypeScript), identity-baseline migration, API health + error/request-ID/log-redaction foundations, worker shell, blank Mini App/admin shells, seed. No product features yet.
- Repo also contains the agile pipeline (`.agile/`, `.claude/commands/`), `AGENTS.md`, `CLAUDE.md`, `CONFIGURATION.md`, `README.md` (local run steps), and the design handoff.
- **Claude Design handoff present** at `designs/creator-chat-design-handoff/design/` (173 boards). Board → route maps, tokens, resolved conflicts and gaps: `design-integration.md`.
- **US-002 built (ready for UAT):** `packages/ui` (tokens, Inter, icons, shared components), admin shell (sidebar/rail/mobile menu/topbar/logout dialog), Mini App shells (customer + creator bottom navs), dev-only `/__preview` pages, Playwright visual harness (`pnpm visual`). Shell destinations are neutral "belum dibangun" placeholders.
- **US-003 built (ready for UAT):** admin login/refresh/logout/me API with rotating refresh tokens, CSRF, Redis lockout and audit; admin `/login` page, route protection and real Logout; `pnpm admin:create`. Dev topology: the admin Vite server proxies `/v1` to the API.
- **US-004 built (ready for UAT):** Mini App login with Telegram — `POST /v1/auth/telegram` validates initData (HMAC + max age), `GET /v1/me`, `UserJwtGuard`; Mini App Telegram wrapper, in-memory session, AuthLogin / AuthOutside / AuthStates screens, USER → `/chats` and CREATOR → `/inbox`; `pnpm telegram:initdata` for local testing. Role enforcement and the blocked-account message are US-006.
- **US-005 built (ready for UAT):** grammY webhook `POST /v1/telegram/webhook` (secret header checked before parsing, webhook reply, no inline Bot API call), minimal `Creator` table with `public_code`, `GET /v1/creators/by-code/:publicCode`, Mini App `/creators/:publicCode` (designed "Creator tidak tersedia" state, placeholder for a CREATOR opening a link), `pnpm telegram:webhook`. Real Telegram untested here.
- **US-006 built (ready for UAT):** `@Roles()` + `RolesGuard` (fail closed) on every user route, `AccountSecurityService` (block / unblock / change role bump `session_version`, revoke sessions, audit), `authorizeConnection()` for the future socket gateway, Mini App role-gated shells and a placeholder blocked-account message. The socket rule is a tested function, not a live socket (no gateway yet).
- Next step: Phase A is complete once US-006 passes UAT; Phase B (profiles and creator applications) is next.

## Project Structure (target — see `tech-stack.md`)

```
apps/miniapp        built (shells + Telegram login, port 5173)  React + Vite Telegram Mini App
apps/admin          built (blank shell, port 5174)  React + Vite admin dashboard
apps/api            built (health, admin auth, Telegram login, bot webhook, creator link)  NestJS 12 + Fastify API; Socket.IO _planned_
apps/worker         built (shell, no queues)  BullMQ processors + outbox reconciler _planned_
packages/db         built  Prisma 7 schema, migrations, seed, `./testing` helpers
packages/contracts  built (errors, health, Telegram ID)  shared schemas/types/error codes/socket events
packages/backend-core built (env config, integration status, log redaction)  shared domain services
packages/ui         built (US-002)  source-only shared components, icons, tokens.css, fonts.css, base.css
visual/              built (US-002)  Playwright harness: app regions vs design PNGs (pnpm visual)
scripts              built  setup-postgres.sql (local role + dev/test databases)
```

## Roles & Principals

| Principal | Source | Notes |
|-----------|--------|-------|
| USER | `User.role = USER` (default for every new Telegram account) | Subscriber status is per-creator access, not a role |
| CREATOR | `User.role = CREATOR`, set only by admin approval | Same account; no customer mode; no switcher |
| Admin | `AdminAccount` (separate table) | Username/password + JWT; `/v1/admin` only |

Account status: `ACTIVE` / `BLOCKED` (separate from subscription expiry).

## Entities

| Entity | Status | Description |
|--------|--------|-------------|
| User | built (US-001) | `users`: telegram_id BigInt UNIQUE, role USER/CREATOR, status ACTIVE/BLOCKED, profile fields, timezone, session_version |
| AdminAccount | built (US-001) | `admin_accounts`: unique lowercase username, Argon2id hash, status ACTIVE/DISABLED |
| Session | built (US-001, extended US-003/US-004) | `sessions`: exactly one of user/admin (CHECK), expiry/revoke. Admin sessions hold the HMAC of the refresh token (+ `previous_refresh_token_hash`, `rotated_at`, US-003). User (Mini App) sessions have no refresh token (`refresh_token_hash` NULL) and record the user's `session_version` (US-004); CHECK `sessions_credentials_chk` enforces both |
| Creator | built (US-005, minimal) | `creators`: `user_id` UNIQUE FK (RESTRICT), `public_code` UNIQUE (CHECK `^[a-z2-7]{8}$`), `status` ACTIVE/BLOCKED. Profile fields come with Phase B; seed has 3 fixture creators (`salsa234`, `kirana23`, `dinda234`) |
| AuditLog | built (US-001) | `audit_logs`: append-only (DB trigger rejects UPDATE/DELETE) |
| _(rest of brief §13)_ | planned | Added by later phases' migrations |

## API Endpoints

| Method | Route | Status | Description |
|--------|-------|--------|-------------|
| GET | `/v1/health` | built (US-001) | Unauthenticated. `{status: ok\|degraded, checks:{db,redis}}`; 503 when degraded; no secrets |
| POST | `/v1/admin/auth/login` | built (US-003) | Public + Origin allowlist. `{username, password}` → `{admin:{id,username,role}}` + 3 cookies. 401 `INVALID_CREDENTIALS` `{attempts,max}`, 429 `LOGIN_LOCKED` `{retry_after_seconds}` (5 failures → 15 min, Redis), 429 `RATE_LIMITED` (IP), 503 if Redis/secrets unavailable |
| POST | `/v1/admin/auth/refresh` | built (US-003) | Refresh cookie + CSRF. Rotates the refresh token; reuse after a 10 s grace revokes the session; 401 clears cookies (except a racing tab) |
| POST | `/v1/admin/auth/logout` | built (US-003) | CSRF. Revokes the session (by access cookie, else refresh cookie), clears cookies, 204, idempotent |
| GET | `/v1/admin/auth/me` | built (US-003) | `AdminJwtGuard`. The admin loaded from the DB |
| POST | `/v1/auth/telegram` | built (US-004) | Public. `{init_data}` → `{access_token, token_type:"Bearer", expires_in:3600, user}`. 401 `TELEGRAM_AUTH_INVALID` / `TELEGRAM_AUTH_EXPIRED`, 403 `ACCOUNT_BLOCKED` (no session), 429 `RATE_LIMITED` (+`Retry-After`; per IP 20/min, 5 invalid/min), 503 when the bot token/secret is unset or Redis is down. Creates a USER on first login |
| GET | `/v1/me` | built (US-004) | `UserJwtGuard` (Bearer only). The account from the database (role, status, profile; `telegram_id` as a string) |
| POST | `/v1/telegram/webhook` | built (US-005) | Public, protected only by `X-Telegram-Bot-Api-Secret-Token` (constant-time, checked before the body is parsed): 401 wrong/missing, 503 when token/username/secret(>=32)/`MINIAPP_URL` is unset. Answers `/start [c_<code>]` in a private chat with a `web_app` button as the webhook reply; every other update 200 with no reply |
| GET | `/v1/creators/by-code/:publicCode` | built (US-005) | `UserJwtGuard` + `@Roles('USER')`. 200 `{public_code, display_name, avatar_url}`; one identical 404 `CREATOR_NOT_FOUND` for unknown/malformed/blocked; 403 `FORBIDDEN_ROLE` for a CREATOR (`RolesGuard`); writes and grants nothing |

Cross-cutting (built, US-001): every response carries `x-request-id`; errors are `{code, message, request_id}`; CORS allowlist from `ALLOWED_ORIGINS`; 1 MiB body limit.

User scope (built, US-004): user controllers import `AuthModule` (`apps/api/src/modules/auth/`) and use `@UseGuards(UserJwtGuard)` + `@CurrentUser()`. The guard reads only `Authorization: Bearer` (cookies never count) and re-checks the session row, the account status and `session_version` on every request; it cannot authenticate an admin token (different audience) and the admin guard cannot authenticate a user token. `/v1/auth/*` and `/v1/me` are `Cache-Control: no-store`. Audit actions: `user.account.created`, `user.login.blocked`. Role enforcement (US-006): user controllers use `@UseGuards(UserJwtGuard, RolesGuard)` and declare `@Roles('USER' | 'CREATOR')` per route; `RolesGuard` compares the role from the live account row and answers 403 `FORBIDDEN_ROLE` for a mismatch or a missing declaration (fail closed). `/v1/me` allows both roles. `AccountSecurityService` (backend-core) is the only writer of account status/role; audit actions `user.account.blocked`, `user.account.unblocked`, `user.role.changed`. `authorizeConnection(auth, token, { roles })` is the reusable connection check for the Phase C socket gateway.

Admin scope (built, US-003): every `/v1/admin/*` response is `Cache-Control: no-store`. New controllers under `apps/api/src/admin/` import `AdminAuthModule` and use `@UseGuards(CsrfGuard, AdminJwtGuard)`; the guard reads only the access cookie (never a Bearer header) and re-checks the session row and admin status on every request. Cookies: `cc_admin_at` (HttpOnly, path `/v1/admin`), `cc_admin_rt` (HttpOnly, path `/v1/admin/auth`), `cc_admin_csrf` (readable, echoed in `X-CSRF-Token`). Audit actions written: `admin.login.succeeded|failed|locked`, `admin.logout`, `admin.refresh.reuse_detected`, `admin.password.reset`, `admin.account.created`. CLI: `pnpm admin:create` (`--password-env`, `--reset-password`).

## Socket Events

| Event | Status | Payload |
|-------|--------|---------|
| _(none yet)_ | | |

## Queues / Jobs

| Queue | Status | Purpose |
|-------|--------|---------|
| _(none yet)_ | | |

## Mini App Routes

| Route | Role | Screen (export ref) | Status |
|-------|------|---------------------|--------|
| (any route, signed out) | any | `AuthLogin` (inside Telegram, first launch), `AuthOutside`, `AuthStates` (connecting / "Belum bisa masuk" / "Sesi Telegram berakhir") | built (US-004); every route except `/__preview` needs a signed-in account |
| `/` | any | lands USER on `/chats`, CREATOR on `/inbox` (role from `/v1/me`) | built (US-004) |
| `/chats`, `/explore`, `/subscriptions`, `/profile` | USER | customer shell + "belum dibangun" placeholder | shell only (US-002); signed-in only; a CREATOR is redirected to `/inbox` (US-006) |
| `/inbox`, `/gallery`, `/broadcast`, `/settings` | CREATOR | creator shell + placeholder | shell only (US-002); signed-in only; a USER is redirected to `/chats` (US-006) |
| `/creators/:publicCode` | USER (CREATOR sees an explanation) | deep-link landing: `StatesProfile` "Creator tidak tersedia" for unavailable codes; neutral stub for a valid code; CREATOR explanation is a design-gap placeholder | built (US-005); outside both shells; the real creator profile is a later story |
| `/__preview` | dev only | component preview | dev only, outside auth, never in `dist` |
| `/?tgdev=<initData>` | dev only | fakes the Telegram WebApp with initData from `pnpm telegram:initdata` | dev only, not in `dist` |

## Admin Routes

| Route | Screen (export ref) | Status |
|-------|---------------------|--------|
| `/login` | `AdmLogin`, `AdmLoginStates` | built (US-003); redirects to the dashboard when already signed in |
| `/` | `AdmDashboard` (shell + placeholder + API health) | shell only; requires a signed-in admin (US-003) |
| `/creators`, `/users`, `/logs`, `/ai`, `/settings` | shell + "belum dibangun" placeholder | shell only; requires a signed-in admin |
| `*` | not-found placeholder inside the shell | requires a signed-in admin |
| `/__preview` | component preview | dev only, outside auth, never in `dist` |

## Design Handoff Inventory

Full board → route mapping lives in `design-integration.md` ("Miniapp Board Map", "Admin Route Map"). Track implementation progress here as screens are built.

| Area | Boards | Implemented |
|------|--------|-------------|
| Foundation (tokens, components) | `Main`, `CrMain`, `AdmMain`, `AdmTableStates`, shell boards | partial (US-002): tokens, Inter, icons, button, input/password/search/select, status chip, card, kv-list, tabs, toast, confirm dialog, data table frame + pagination, admin shell, Mini App bottom navs. Not yet: gallery tiles, chat bubbles, message-status icons, avatar/switch, status panels, charts, composer |
| Miniapp — auth/profile/request | `Auth*`, `Profile*`, `EditProfile`, `EditStates`, `CreatorRequest*`, `Request*` | partial: `StatesProfile` "Creator tidak tersedia" card (US-005); `AuthLogin`, `AuthOutside`, `AuthStates` (US-004; the DEMO strip is not built; "Syarat Layanan" / "Kebijakan Privasi" pages and the blocked-account message are design gaps). Not yet: `AuthMain` rules beyond login, profile, creator request |
| Miniapp — customer | `Chats`, `Explore`, `Creator{Guest,Pending,Active,Expired}`, `Chat`, `ChatExpired`, `Subscriptions`, `Media*`, `States*` | no |
| Miniapp — creator | `CrInbox`, `CrChat*`, `CrCustomer`, `CrAttach`, `CrGallery*`, `CrViewer*`, `CrBroadcast*`, `CrSettings`, `CrEditProfile`, `CrPersona`, `CrPrice*`, `CrWelcome*`, `CrTimezone`, `CrStates*` | no |
| Admin | `AdmLogin*`, `AdmDash*`, `AdmCreators*`, `AdmCr*`, `AdmUsers*`, `AdmUser*`, `AdmLog*`, `AdmAi*`, `AdmSet*`, `AdmDlg*`, `AdmTableStates` | partial: `AdmLogin`, `AdmLoginStates` (US-003, locked state is a design gap), `AdmLogoutDlg` (US-002, now wired to the API); shell from `AdmDashboard`/`AdmDashTablet`/`AdmDashMobile` |

Open design gaps (see `design-integration.md`): the blocked-account message (placeholder in US-006), the "creator opened another creator's link" explanation (placeholder in US-005), bot message copy (placeholder constants), AI-assistance disclosure + Syarat Layanan/Kebijakan Privasi pages, admin queue for customer access requests, per-creator mute control, invalid-link / creator-opens-other-creator screens.

## Feature Backlog

| Feature | Phase | Stories | Status |
|---------|-------|---------|--------|
| workspace-foundation | A | US-001…002 | US-001 ready_for_uat, US-002 ready_for_uat |
| admin-auth | A | US-003 | US-003 ready_for_uat |
| telegram-auth | A | US-004…006 | US-004 ready_for_uat, US-005 ready_for_uat, US-006 ready_for_uat |
