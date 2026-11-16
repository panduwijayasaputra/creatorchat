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
- **US-007 built (ready for UAT, Phase B):** `PATCH /v1/me/profile` (USER only; name 1–40, bio ≤160 by code point, unknown keys stripped, `reset_avatar`), `users.telegram_avatar_url` (refreshed every login), `ProfileService`, Mini App `/profile` and `/profile/edit` with the four `EditStates`, `Avatar` / `Switch` in `packages/ui`, `BottomToast`. Notifikasi switches are disabled until Phase E; Kebijakan Privasi, "Ganti Foto" and the server-error banner text are placeholder copy (gaps).
- **US-008 built (ready for UAT, Phase B):** CREATOR-only `GET /v1/creator/settings` and `PATCH /v1/creator/profile` (same rules as the customer edit; `ProfileService` takes a role), server-built bio link (`https://t.me/<bot>?start=c_<code>`), `GET /v1/creators/by-code/:code` also returns `bio`, Mini App `/settings` (`CrSettings`) and `/settings/profile` (`CrEditProfile`), shared `ProfileForm`, `CopyIcon` / `GlobeIcon`. Persona, welcome message, price and timezone rows open "belum dibangun" placeholders with no fake chips; creator category/city is a design gap. Real Telegram (WebView clipboard) untested.
- **US-009 built (ready for UAT, Phase B):** `PATCH /v1/creator/timezone` (CREATOR-only; five allowed zones, display only), `timezone` added to the shared `UserProfile`, `ProfileService.updateOwnTimezone`, Mini App `/settings/timezone` (`CrTimezone`), the `CrSettings` row shows the saved zone, and `formatDateTime` / `formatTime` for every future time display (no screen shows a time yet). No migration.
- **US-010 built (ready for UAT, Phase B):** `creator_applications` and a minimal `subscriptions` table (migration `20261119010000`), `GET` / `POST /v1/me/creator-request` (USER only; one PENDING per user by a partial unique index; blocked by an active or future customer subscription), `CreatorRequestService`, Mini App `/profile/creator-request` (`CreatorRequest`, `RequestStates`, `CreatorRequestBlocked`) and the `ProfileBlocked` variant. The seed gives Raka Putra a subscription to Salsa until 27 Nov 2026. After submit the user lands on a placeholder status route (US-011). No admin review, no bot message yet (US-012/013). Real Telegram untested; run `pnpm db:migrate` on the dev database.
- Next step: Phase A is complete once US-006 passes UAT; the rest of Phase B (US-008…019) is next.

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
| User | built (US-001, extended US-007) | `users`: telegram_id BigInt UNIQUE, role USER/CREATOR, status ACTIVE/BLOCKED, `display_name`, `bio`, `avatar_url` (app photo), `telegram_avatar_url` (Telegram photo as of the last login, US-007), timezone, session_version |
| AdminAccount | built (US-001) | `admin_accounts`: unique lowercase username, Argon2id hash, status ACTIVE/DISABLED |
| Session | built (US-001, extended US-003/US-004) | `sessions`: exactly one of user/admin (CHECK), expiry/revoke. Admin sessions hold the HMAC of the refresh token (+ `previous_refresh_token_hash`, `rotated_at`, US-003). User (Mini App) sessions have no refresh token (`refresh_token_hash` NULL) and record the user's `session_version` (US-004); CHECK `sessions_credentials_chk` enforces both |
| Creator | built (US-005, minimal) | `creators`: `user_id` UNIQUE FK (RESTRICT), `public_code` UNIQUE (CHECK `^[a-z2-7]{8}$`), `status` ACTIVE/BLOCKED. Profile fields come with Phase B; seed has 3 fixture creators (`salsa234`, `kirana23`, `dinda234`) |
| CreatorApplication | built (US-010) | `creator_applications`: `user_id` FK (RESTRICT), `creator_name`, `instagram_url` (normalised), `creator_type` HUMAN/AI_CHARACTER, `description`, `status` PENDING/APPROVED/REJECTED, review fields (`reviewed_by_admin_id`, `reviewed_at`, `review_reason`; CHECK ties them to the status). **Partial unique index: one PENDING per user.** History is never overwritten. US-010 only writes PENDING rows |
| Subscription | built (US-010, minimal) | `subscriptions`: `customer_id` → users, `creator_id` → creators (RESTRICT), `starts_at`, `ends_at` (CHECK `ends_at > starts_at`), `revoked_at`; UNIQUE (customer, creator). No grant/extend/revoke API or event history until Phase C. Seed: Raka Putra → Salsa until 2026-11-27 |
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
| GET | `/v1/me` | built (US-004, extended US-007) | `UserJwtGuard` (Bearer only). The account from the database (role, status, profile incl. `bio`, `avatar_url`, `telegram_avatar_url`, `timezone`; `telegram_id` as a string) |
| PATCH | `/v1/me/profile` | built (US-007) | `UserJwtGuard` + `@Roles('USER')` (CREATOR → 403 `FORBIDDEN_ROLE`). Body `{display_name, bio?, reset_avatar?}` is the full desired profile (idempotent); trimmed, name 1–40 / bio ≤160 code points, no control characters, blank bio → null; other keys (`id`, `role`, `telegram_id`, `username`, `status`, ...) stripped. 400 `VALIDATION_FAILED`, 401 for a blocked / stale / admin session (write limited to ACTIVE rows in one statement). Returns the updated account; `no-store`. No audit row |
| GET | `/v1/creator/settings` | built (US-008) | `UserJwtGuard` + `@Roles('CREATOR')` (USER → 403 `FORBIDDEN_ROLE`; no ACTIVE `creators` row → 403 `FORBIDDEN`). `{profile, public_code, bio_link}`; `bio_link` is `https://t.me/<TELEGRAM_BOT_USERNAME>?start=c_<public_code>` or `null` when the bot username is unset/malformed. Caller's own data only; `no-store` |
| PATCH | `/v1/creator/profile` | built (US-008) | `UserJwtGuard` + `@Roles('CREATOR')`. Same body and rules as `PATCH /v1/me/profile`; no creator/user id in the request (`id`, `public_code`, `role`, `status`... stripped). One UPDATE limited to ACTIVE user + CREATOR role + ACTIVE `creators` row; 401 when that no longer holds; returns the updated account; `no-store`. Name, bio and photo are the `users` columns, so customers see them on the by-code lookup |
| PATCH | `/v1/creator/timezone` | built (US-009) | `UserJwtGuard` + `@Roles('CREATOR')`. Body `{timezone}` must be one of `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`, `Asia/Singapore`, `Australia/Sydney` (else 400 `VALIDATION_FAILED`, nothing changes); other keys stripped; no id in the request. One UPDATE limited to ACTIVE user + CREATOR role + ACTIVE `creators` row; 401 when that no longer holds; returns the updated account; `no-store`. Stored timestamps are never rewritten |
| GET | `/v1/me/creator-request` | built (US-010) | `UserJwtGuard` + `@Roles('USER')` (CREATOR → 403 `FORBIDDEN_ROLE`). `{request, blocked}`: the caller's latest request (any status) or null, and the active/future subscription that blocks a new one (`{creator_name, ends_at}`, the one that ends last) or null. Own data only; `no-store` |
| POST | `/v1/me/creator-request` | built (US-010) | `UserJwtGuard` + `@Roles('USER')`. Body `{creator_name, instagram_url, creator_type, description, rights_confirmed: true}` (name 1–40, Instagram profile URL normalised to `https://instagram.com/<handle>`, type HUMAN/AI_CHARACTER, description 1–300 code points); `user_id`/`role`/`status`/`id` stripped. 400 `VALIDATION_FAILED` (field messages in `details`), 409 `CREATOR_REQUEST_BLOCKED` (`details` = the block; nothing written or changed), 401 for a blocked / promoted / stale session. One transaction: lock the user row, return the existing PENDING request if any (idempotent, 200), else check the block, insert PENDING + audit `creator.application.submitted`. Role stays USER; `no-store` |
| POST | `/v1/telegram/webhook` | built (US-005) | Public, protected only by `X-Telegram-Bot-Api-Secret-Token` (constant-time, checked before the body is parsed): 401 wrong/missing, 503 when token/username/secret(>=32)/`MINIAPP_URL` is unset. Answers `/start [c_<code>]` in a private chat with a `web_app` button as the webhook reply; every other update 200 with no reply |
| GET | `/v1/creators/by-code/:publicCode` | built (US-005) | `UserJwtGuard` + `@Roles('USER')`. 200 `{public_code, display_name, bio, avatar_url}`; one identical 404 `CREATOR_NOT_FOUND` for unknown/malformed/blocked; 403 `FORBIDDEN_ROLE` for a CREATOR (`RolesGuard`); writes and grants nothing |

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
| `/chats`, `/explore`, `/subscriptions` | USER | customer shell + "belum dibangun" placeholder | shell only (US-002); signed-in only; a CREATOR is redirected to `/inbox` (US-006) |
| `/profile` | USER | `Profile` (inside the customer shell) | built (US-007); `ProfileBlocked` variant while a customer subscription is active (US-010); disabled Notifikasi switches, Kebijakan Privasi placeholder, Hubungi Admin via `VITE_TELEGRAM_BOT_USERNAME`; the pending / rejected / blocked variants come with US-010/011 |
| `/profile/edit` | USER | `EditProfile` + `EditStates` (no bottom nav) | built (US-007); Ganti Foto is a placeholder until Phase D |
| `/profile/creator-request` | USER | `CreatorRequest`, `RequestStates`, `CreatorRequestBlocked` (no bottom nav) | built (US-010); prefilled name, Instagram, type radios, description counter, rights checkbox; inline validation, sending, failure (values kept) and blocked variants; a pending request redirects to the status route; load / load-failed copy is placeholder |
| `/profile/creator-request/status` | USER | _(US-011)_ | `NotImplemented` placeholder; a submitted or pending request lands here |
| `/inbox`, `/gallery`, `/broadcast` | CREATOR | creator shell + placeholder | shell only (US-002); signed-in only; a USER is redirected to `/chats` (US-006) |
| `/settings` | CREATOR | `CrSettings` (inside the creator shell) | built (US-008); no category/city line (gap), no status chips on later rows; Bantuan via `VITE_TELEGRAM_BOT_USERNAME`; "Salin Link Profil" copies the server-built link |
| `/settings/profile` | CREATOR | `CrEditProfile` + `EditStates` (no bottom nav) | built (US-008); the same `ProfileForm` as `/profile/edit`, back to `/settings` |
| `/settings/timezone` | CREATOR | `CrTimezone` (no bottom nav) | built (US-009); radio list of five zones, offsets computed for today, save bar; placeholder copy for the success toast and failure banner |
| `/settings/persona`, `/settings/welcome`, `/settings/price` | CREATOR | _(later stories)_ | `NotImplemented` placeholders that the `/settings` rows point to |
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
| Foundation (tokens, components) | `Main`, `CrMain`, `AdmMain`, `AdmTableStates`, shell boards | partial (US-002): tokens, Inter, icons, button, input/password/search/select, status chip, card, kv-list, tabs, toast, confirm dialog, data table frame + pagination, admin shell, Mini App bottom navs. avatar and switch (US-007). Not yet: gallery tiles, chat bubbles, message-status icons, status panels, charts, composer |
| Miniapp — auth/profile/request | `Auth*`, `Profile*`, `EditProfile`, `EditStates`, `CreatorRequest*`, `Request*` | partial: `Profile`, `EditProfile`, `EditStates` (US-007; the `ProfilePending|Rejected|Blocked` variants and the Kebijakan Privasi page are not built); `StatesProfile` "Creator tidak tersedia" card (US-005); `AuthLogin`, `AuthOutside`, `AuthStates` (US-004; the DEMO strip is not built; "Syarat Layanan" / "Kebijakan Privasi" pages and the blocked-account message are design gaps). Not yet: `AuthMain` rules beyond login, profile, creator request |
| Miniapp — customer | `Chats`, `Explore`, `Creator{Guest,Pending,Active,Expired}`, `Chat`, `ChatExpired`, `Subscriptions`, `Media*`, `States*` | no |
| Miniapp — creator | `CrInbox`, `CrChat*`, `CrCustomer`, `CrAttach`, `CrGallery*`, `CrViewer*`, `CrBroadcast*`, `CrSettings`, `CrEditProfile`, `CrPersona`, `CrPrice*`, `CrWelcome*`, `CrTimezone`, `CrStates*` | partial: `CrSettings`, `CrEditProfile` (US-008), `CrTimezone` (US-009; without the category/city line and the "Tersimpan"/"Aktif" chips and price/timezone values, which belong to later stories). Not yet: the rest |
| Admin | `AdmLogin*`, `AdmDash*`, `AdmCreators*`, `AdmCr*`, `AdmUsers*`, `AdmUser*`, `AdmLog*`, `AdmAi*`, `AdmSet*`, `AdmDlg*`, `AdmTableStates` | partial: `AdmLogin`, `AdmLoginStates` (US-003, locked state is a design gap), `AdmLogoutDlg` (US-002, now wired to the API); shell from `AdmDashboard`/`AdmDashTablet`/`AdmDashMobile` |

Open design gaps (see `design-integration.md`): the blocked-account message (placeholder in US-006), the "creator opened another creator's link" explanation (placeholder in US-005), bot message copy (placeholder constants), AI-assistance disclosure + Syarat Layanan/Kebijakan Privasi pages, admin queue for customer access requests, per-creator mute control, invalid-link / creator-opens-other-creator screens.

## Feature Backlog

| Feature | Phase | Stories | Status |
|---------|-------|---------|--------|
| workspace-foundation | A | US-001…002 | US-001 ready_for_uat, US-002 ready_for_uat |
| admin-auth | A | US-003 | US-003 ready_for_uat |
| telegram-auth | A | US-004…006 | US-004 ready_for_uat, US-005 ready_for_uat, US-006 ready_for_uat |
| profiles | B | US-007…009 | US-007 ready_for_uat, US-008 ready_for_uat, US-009 ready_for_uat |
| creator-applications | B | US-010…013 | US-010 ready_for_uat, US-011…013 backlog |
| admin-accounts | B | US-014…019 | backlog |
