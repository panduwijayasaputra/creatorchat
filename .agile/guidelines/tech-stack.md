# Tech Stack Overview

Product rules live in `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` (the **brief**). This file summarizes the agreed stack (brief §12) and records decisions made at scaffold time.

## Agreed Stack

| Area | Choice |
|------|--------|
| Language | TypeScript end-to-end (strict mode) |
| Monorepo | pnpm workspaces |
| API | NestJS on the Fastify adapter, REST under `/v1`, admin under `/v1/admin` |
| Realtime | Socket.IO (committed events only; HTTP is the write path) |
| Jobs | BullMQ + Redis, in a separate `apps/worker` process |
| Database | PostgreSQL + Prisma (migrations committed) |
| Media | Cloudflare R2, private bucket, short-lived signed URLs |
| Media processing | Sharp / FFmpeg server-side for thumbnails/posters and format checks (no HLS) |
| Local storage key mapping | Decided 2026-11-18 (US-032 build) | Keys stay `m/<creator>/<asset>` and `m/<creator>/<asset>/thumb.webp`; `LocalDiskStorage` stores the original as `<asset>.orig` because a path cannot be a file and a folder at once. R2 is flat and unaffected |
| Upload progress and status | Decided 2026-11-18 (US-032 build) | XHR PUT (fetch has no upload progress) with exactly the signed headers and no credentials; after `complete` the Mini App polls `GET /v1/creator/media/:id` every 2 s for up to 5 min (`shortcut`: switch to a realtime `media.updated` signal if processing gets slow) |
| Media storage settings at boot | Decided 2026-11-18 (US-032 build) | A missing `STORAGE_LOCAL_SIGNING_SECRET` does not stop the API: media answers 503 and the worker skips the media pipeline (like user auth without a bot token). A set but short secret, `STORAGE_DRIVER=local` in production and an incomplete `r2` configuration are env errors |
| Chat media (one attachment, bound uploads) | Decided 2026-11-18 (US-036) | One attachment per message (the table keeps a `position`). A chat upload is bound at `init` to one conversation (`purpose CHAT`, `conversation_id`), can be sent once and only there, never gets a gallery item, and is deleted by the cleanup loop after a day unsent. A gallery pick attaches the same asset. Migrations are split in two because a new enum value cannot be used in the transaction that adds it |
| Media in lists | Decided 2026-11-18 (US-036) | The preview stays a string (empty for a media-only message) with a separate media kind, so text previews and old fixtures are unchanged; the client shows the placeholder words "Foto" / "Video" |
| Received media after expiry | Decided 2026-11-18 (US-036) | Thumbnails and (US-037) originals of files in a conversation are signed for any participant of that conversation without checking the subscription dates: brief §8E, what was received stays readable |
| Telegram bot | grammY, webhook mode with secret validation |
| Mini App | React + Vite, Telegram WebApp runtime |
| Admin | React + Vite, separate app |
| UI | Claude Design handoff re-implemented 1:1 as React components; CSS-variable tokens, Inter, inline SVG icons; no Tailwind/shadcn/UI library (the design uses none) |
| Visual QA | Playwright screenshots at board sizes compared with handoff PNGs |
| Local infra | Native PostgreSQL + Redis on the dev machine (no Docker); Node apps run via pnpm |

**Versions:** do not pick versions from memory. At scaffold time check official docs/compatibility (NestJS ↔ Fastify adapter ↔ Socket.IO adapter, Prisma ↔ Node, BullMQ ↔ Redis, React ↔ Vite), pin exact versions, commit `pnpm-lock.yaml`, and record them below.

## Repository Structure

The design handoff stays untouched in `designs/` as reference; apps re-implement it.

```
CreatorChat/
├── apps/
│   ├── miniapp/            # React + Vite Telegram Mini App (USER + CREATOR UIs)
│   ├── admin/              # React + Vite admin dashboard
│   ├── api/                # NestJS + Fastify HTTP API, Socket.IO gateway, bot webhook
│   └── worker/             # BullMQ processors + outbox reconciler
├── packages/
│   ├── db/                 # Prisma schema, migrations, generated client, seed scripts
│   ├── contracts/          # Shared request/response schemas + types, socket event types, error codes
│   ├── backend-core/       # Framework-light domain services shared by api + worker
│   └── ui/                 # Only components genuinely shared by miniapp + admin (extracted from export)
├── scripts/
│   └── setup-postgres.sql  # creates the local role + dev/test databases
├── designs/creator-chat-design-handoff/design/   # read-only Claude Design handoff (png/, html/, DESIGN.md, INDEX.md)
├── .env.example            # Every variable documented, marked server/client
├── README.md               # Concrete local run steps (native PostgreSQL/Redis setup)
├── AGENTS.md
└── .agile/                 # Agile pipeline (brief, guidelines, stories, plans, QA)
```

Architecture: **modular monolith**. `api` and `worker` are separate processes that share explicit services from `packages/backend-core` and the Prisma client from `packages/db`. No microservices.

## Target Root Scripts

To be implemented in Phase A (they don't exist until scaffolded):

```
pnpm install
pnpm db:migrate        # prisma migrate dev against the local DB
pnpm db:seed           # explicit fixtures; admin seed needs a supplied/generated password
pnpm dev               # api + worker + miniapp + admin in parallel
pnpm typecheck
pnpm lint
pnpm test              # unit + integration (no paid AI, no real Telegram/R2)
pnpm build
```

No Docker: PostgreSQL and Redis run natively (see README). Never run `DROP DATABASE` / `migrate reset` on a database you did not create for the task.

## API Communication

- REST JSON under `/v1`; admin under `/v1/admin` with independent guards.
- Errors: `{ "code": string, "message": string, "request_id": string, "details"?: ... }`.
- Telegram IDs are `bigint` in DB and **strings** in JSON.
- Cursor pagination for chat; offset/page (10/25/50) with total for admin tables.
- Mini App auth: Telegram `initData` validated server-side → app session.
- Admin auth: username/password → short-lived access JWT + rotating refresh token in Secure/HttpOnly cookies, CSRF protection.
- Socket.IO: rooms derived server-side; client never chooses its room by ID.

## Decisions Log

Record each decision with date when made. `TBD` items must be resolved (with the user if needed) before code depends on them.

| Decision | Status | Notes |
|----------|--------|-------|
| Pinned versions | Decided 2026-11-15 (US-001) | See "Pinned Versions" below. BullMQ, grammY, Socket.IO stay TBD until their stories |
| Runtime validation library for `packages/contracts` | Decided 2026-11-15 | Zod 4 |
| Test runner | Decided 2026-11-15 | Vitest everywhere; API uses `unplugin-swc` for decorator metadata |
| Module format | Decided 2026-11-15 | ESM everywhere (`"type": "module"`, `NodeNext`); NestJS 12 is ESM-only. Internal packages compile with `tsc` to `dist` and are consumed through `exports`; relative imports use `.js` extensions |
| Worker bootstrap | Decided 2026-11-15 | Plain Node + `backend-core`, no Nest |
| Local infra on this machine | Decided 2026-11-15 | User runs **native** PostgreSQL 18 (Windows service) and Redis; **Docker is not used** (user decision 2026-11-15, supersedes brief §12/§16 Compose wording; the `infra/` folder and Compose file were removed). Code only uses `DATABASE_URL` / `REDIS_URL` |
| API dev run | Decided 2026-11-15 | `tsc -w` + `node --watch dist/main.js` (tsc emits decorator metadata; esbuild/tsx does not) |
| Chat text limit | Decided 2026-11-17 (US-026) | 2000 Unicode code points after trim; enforced in the contract, the service and a DB CHECK |
| Chat history pagination | Decided 2026-11-17 (US-026) | Keyset on a per-conversation `messages.seq` (`conversations.last_message_seq`, incremented under the conversation row lock); `?before=<seq>&limit=30` |
| Retry after access ended | Decided 2026-11-17 (US-026) | A repeated `client_message_id` returns the stored message even if access has since ended; a different body with the same id is 409 `IDEMPOTENCY_CONFLICT` |
| Creator inbox pagination | Decided 2026-11-17 (US-028) | Keyset cursor on `(conversations.last_message_at, id)`, opaque base64url; `last_message_at` is set in the same transaction as each message |
| Unread source | Decided 2026-11-17 (US-028) | `conversation_reads (conversation_id, user_id, last_read_seq)` created in US-028, moved by US-030; unread = other participant's messages above the cursor |
| Realtime event payload | Decided 2026-11-17 (US-031) | Signals only (`message.created {conversation_id, seq}`, `read.updated {conversation_id, through_seq}`, `conversation.updated {conversation_id}`, `session.ended`); no content over the socket or Redis, the client refetches over HTTP |
| Realtime delivery marker | Decided 2026-11-17 (US-031) | `outbox_events.realtime_published_at`; the worker publisher stamps after emitting (at-least-once, it is also the reconciler); independent of the Telegram `status`; rows older than 15 min are stamped without emitting |
| Socket.IO gateway | Decided 2026-11-17 (US-031) | Plain `socket.io` on the Fastify HTTP server (`/realtime`) with the Redis adapter; worker uses the Redis emitter; rooms `user:<id>` only, joined by the server from the verified token; no client events are read |
| Immediate socket disconnect | Decided 2026-11-17 (US-031) | `AccountSecurityService` runs `pg_notify('account_security', user_id)` inside its transaction (delivered only on commit); the API listens and calls `disconnectSockets`; a 30 s recheck (`authenticate`) covers expired tokens and any path that bypasses it. Chosen over an after-commit callback because every real caller uses the in-transaction variants |
| Realtime client behaviour | Decided 2026-11-17 (US-031) | Token read at each connect, renewed through the API client after a refusal or server hang-up with doubling backoff (1 s … 30 s); list refetches throttled to 2 s with a trailing call; the chat refetch is coalesced and, after a reconnect, unsent bubbles are re-posted with the same `client_message_id` |
| Message origin | Decided 2026-11-17 (US-029) | `messages.origin` enum MANUAL / AI, NOT NULL DEFAULT MANUAL; written by the sender's service, shown to the creator only (the "Manual" tag), never in customer answers; Phase F sets AI |
| Creator access states | Decided 2026-11-17 (US-029) | The creator API reports only ACTIVE / EXPIRED (expired, revoked, no subscription and a blocked or promoted customer are all EXPIRED), the same rule as the inbox chip; the customer API keeps its three states |
| Shared chat UI | Decided 2026-11-17 (US-029) | One thread hook (`useThread` + adapter) and `ChatThread` components serve the customer and creator chats; each side keeps its own endpoints and contracts |
| Inbox offline panel | Decided 2026-11-17 (US-028) | Driven by browser `online` / `offline` events until US-031 supplies the socket state |
| Read cursor writes | Decided 2026-11-17 (US-030) | Explicit `POST …/read {through_seq}`; monotonic (`GREATEST`, conditional update), clamped to the conversation's newest seq; a real move writes an outbox `read.updated` (ids and the new seq) in the same transaction |
| "Dibaca" marker | Decided 2026-11-17 (US-030) | Double tick + word under my latest message the creator has read, in active and expired chats; only the customer receives the creator's cursor (`peer_read_seq`) |
| Mini App + admin router / server-state library | Decided 2026-11-15 (US-002) | React Router now (shell navigation); TanStack Query is added by the first story that needs API data |
| Package sharing for UI | Decided 2026-11-15 (US-002) | `packages/ui` is source-only (exports point at `src`, no dist); consumed and compiled by Vite/Vitest in each app |
| Component styling | Decided 2026-11-15 (US-002) | CSS Modules + one global tokens.css in `packages/ui`; no Tailwind/shadcn/UI library |
| Inter font delivery | Decided 2026-11-15 (US-002) | Self-hosted Inter 400/500/600/700 (latin) via `@fontsource/inter`; same typeface as the boards |
| Visual regression | Decided 2026-11-14; tooling 2026-11-15 (US-002) | Playwright (`@playwright/test`, root devDependency, `pnpm visual`) screenshots vs `design/png`; human review of side-by-side sheets, no pixel threshold in CI |
| Icons | Decided 2026-11-15 (US-002) | Inline SVG React components copied from the boards (custom set, not Lucide) |
| Admin lockout storage | Decided 2026-11-15 (US-003) | Redis counters per normalized username (5 failures → 15 min lock) + per-IP limiter; fails closed if Redis is down |
| Admin access token library | Decided 2026-11-15 (US-003) | `jose` (HS256, algorithm pinned); version pinned at install |
| Admin dev topology + CSRF | Decided 2026-11-15 (US-003) | Admin Vite dev server proxies `/v1` to the API (same-origin); Origin allowlist + double-submit `X-CSRF-Token`; cookies HttpOnly, path-scoped (`cc_admin_at` `/v1/admin`, `cc_admin_rt` `/v1/admin/auth`) |
| Admin client data layer | Decided 2026-11-15 (US-003) | fetch client + AuthProvider; TanStack Query still deferred to the first list screen |
| Telegram WebApp SDK | Decided 2026-11-15 (US-004) | Official `telegram-web-app.js` script in the Mini App `index.html` + a thin typed wrapper (`src/telegram/`); no npm SDK |
| Mini App session token | Decided 2026-11-15 (US-004) | HS256 JWT (`jose`, `USER_SESSION_SECRET`) in memory, Bearer header, 60 min, no refresh; re-exchange `initData` on expiry/reopen; every request re-checks the session row, status and `session_version` |
| Local Telegram login testing | Decided 2026-11-15 (US-004) | Real HMAC validation always; `pnpm telegram:initdata` signs fake initData with the local token and the dev-only `?tgdev=` loads it; no bypass endpoint |
| Telegram profile photo | Decided 2026-11-15 (US-004) | `photo_url` stored once in `users.avatar_url` at creation (hot-linked); R2 copy deferred to the media phase |
| Bot deep-link transport (US-005) | Decided 2026-11-15 | Bot `web_app` button opens `MINIAPP_URL/creators/<public_code>`; the path survives login (router sits under `AuthProvider`); the bot accepts only `^c_[A-Za-z0-9_-]{1,62}$`, else opens without a destination |
| `public_code` format (US-005) | Decided 2026-11-15 | 8 chars lowercase base32 (`a-z2-7`), server-generated, immutable, UNIQUE; readable slug deferred to the creator profile |
| Creator result notification (US-013) | Decided 2026-11-16 | The worker polls the outbox (no queue access from the API); retries, backoff and `retry_after` live in PostgreSQL and the BullMQ job always completes; ambiguous sends (timeout/crash) are retried and flagged, at-least-once; a 403 sets `users.bot_blocked_at`, cleared by `/start`; plain-text messages (no `parse_mode`); job ids are reused so completed jobs are removed at once; the DB session is pinned to UTC |
| Webhook handling (US-005) | Decided 2026-11-15 | grammY 1.46.0 (pinned), secret header checked in constant time before parsing, webhook reply (no inline Bot API call), `botInfo` from config (no `getMe`); the worker uses the same pin for outbound messages (US-013) |
| Roles and session invalidation (US-006) | Decided 2026-11-15 | `@Roles()` + `RolesGuard` (fail closed) on every user route; `AccountSecurityService` is the single writer of account status/role and bumps `session_version`, revokes sessions and audits; no Socket.IO yet, so the connection rule is a framework-free `authorizeConnection()` the Phase C gateway must call |
| Profile edit (US-007) | Decided 2026-11-16 | `PATCH /v1/me/profile` carries the full desired profile (idempotent); unknown body keys are stripped, not rejected; "Pakai Foto Telegram" is a `reset_avatar` flag applied on save, backed by `users.telegram_avatar_url` (refreshed every login; `avatar_url` is the app photo); limits (name 1–40, bio ≤160, by code point) live in `packages/contracts`, not DB CHECKs |
| Mini App server state (US-007) | Decided 2026-11-16 | TanStack Query still deferred: the profile is the session's `/me` in `AuthProvider`; `updateProfile()` updates that in-memory user. Revisit at the first real list screen |
| Creator public profile store (US-008) | Decided 2026-11-16 | A creator's public name, bio and photo are the `users` columns (`display_name`, `bio`, `avatar_url`); no `creator_profiles` table. Creator category/city has no designed input (gap) and is not stored |
| Creator profile API (US-008) | Decided 2026-11-16 | CREATOR-only `GET /v1/creator/settings` and `PATCH /v1/creator/profile`; same Zod schema and `ProfileService` as the customer edit (`role` argument). `PATCH /v1/me/profile` stays USER-only |
| Bio link (US-008) | Decided 2026-11-16 | Built on the server: `https://t.me/<TELEGRAM_BOT_USERNAME>?start=c_<public_code>`; `null` when the bot username is unset or malformed. `GET /v1/creators/by-code/:code` also returns `bio` |
| Creator timezone (US-009) | Decided 2026-11-16 | Only the five designed zones are accepted (`TIMEZONE_OPTIONS` in contracts: Asia/Jakarta, Asia/Makassar, Asia/Jayapura, Asia/Singapore, Australia/Sydney); anything else is 400. The column stays plain text (no CHECK), so the list grows without a migration. Display only: stored timestamps stay UTC |
| UTC offset text (US-009) | Decided 2026-11-16 | Computed with `Intl` for the current date (`utcOffsetLabel`), not copied from the board, because Sydney is UTC+10 outside daylight saving. WIB/WITA/WIT names and IANA ids stay verbatim |
| Timezone in the profile (US-009) | Decided 2026-11-16 | `UserProfile.timezone` is part of login, `/me` and edit responses; `PATCH /v1/creator/timezone` (CREATOR-only) changes only it. Screens format times with `formatDateTime(value, user.timezone)` (`apps/miniapp/src/format/date-time.ts`) |
| One pending creator request (US-010) | Decided 2026-11-16 | `creator_applications` has a partial unique index (one PENDING row per user) and the submit locks the user row, so a double tap, retry or second tab returns the existing request instead of an error. Rejected and approved requests are kept as history; a new request is a new row. The table already has the review columns (US-012) |
| Customer subscription block (US-010) | Decided 2026-11-16 | Minimal `subscriptions` table (customer, creator, starts/ends, revoked; one row per pair). A request is refused (409 `CREATOR_REQUEST_BLOCKED`) while `revoked_at IS NULL AND ends_at > now()`, which covers active and future access. Nothing is revoked automatically. `GET /v1/me/creator-request` reports the subscription that ends last. Grant/extend/revoke come with Phase C; the seed gives Raka Putra one |
| Instagram link (US-010) | Decided 2026-11-16 | Syntax only: http(s), host `instagram.com` / `www.instagram.com`, one handle segment of `[A-Za-z0-9._]{1,30}`; stored as `https://instagram.com/<handle>`. The account is not checked (an admin reviews it) |
| Creator request retry and precedence (US-011) | Decided 2026-11-16 | No new endpoint: `GET /v1/me/creator-request` already returns the latest request. Retry lives on the same route as the form (`CreatorRequestRetry` when the latest request is REJECTED: prefilled, reason card, rights checkbox unchecked) and creates a new PENDING row. Profile card precedence: pending > blocked > rejected > invitation. The status comes from the server on every screen. Seed: Maya Lestari pending, Luna Aurora rejected, Raka Putra none |
| Outbox scope split (US-012) | Decided 2026-11-16 | US-012 creates `outbox_events` and a write-only `OutboxService.add(tx, …)` (one event per decision, UNIQUE `dedupe_key`, ids-only payload). The dispatcher, reconciler, queue and bot send are US-013, so no Telegram message is sent until then |
| Creator data on approval (US-012) | Decided 2026-11-16 | `creators.creator_type` (default HUMAN) and nullable `instagram_url` are copied from the approved request; the requested name is copied into `users.display_name` (audited as `display_name: [old, new]`); the creator can edit it later in Pengaturan |
| Approval transaction (US-012) | Decided 2026-11-16 | One transaction, lock order user row then application row (the submit takes only the user row). `AccountSecurityService` gained `…InTransaction(tx, …)` variants so the role change joins the approval; public methods unchanged. `public_code` is inserted with `ON CONFLICT DO NOTHING` and a bounded retry because a plain failed insert would abort the transaction. A future Phase C grant must lock the same user row and refuse role CREATOR |
| Review endpoints and pre-check (US-012) | Decided 2026-11-16 | `/v1/admin/creator-requests/:id` is addressed by the application id (never a user id). `GET` returns the request, applicant and the approval pre-check; the approve dialog opens in the "cannot approve" state if the pre-check already finds a subscription, and the confirm call re-checks inside the transaction (409 `CREATOR_APPROVAL_BLOCKED`). Reject works for any PENDING request, including a blocked applicant's. Admin times show in WIB |
| Review dialogs before their host pages (US-012) | Decided 2026-11-16 | The approve/reject dialogs, the admin API calls and the `ConfirmDialog` additions are built and shown in `/__preview`; wiring them to the `/creators` list and detail is acceptance in US-014 / US-015. Visual items compare only the dialog card (`refHeight` pins the approve boards' crop because the fallback font wraps differently offline) |
| Seed requests (US-012) | Decided 2026-11-16 | Raka Putra gets a pending request next to his subscription (approving him fails, `AdmDlgApproveFail`); his earlier US-010 "blocked" Profile screens are no longer reachable in the seed because a pending request wins |
| Notification switches (US-007) | Decided 2026-11-16 | Shown disabled in the designed default state, persisting nothing until Phase E |
| Bot copy (US-005) | Placeholder — open input | Undesigned Indonesian placeholder copy in one constants file; user supplies final wording |
| AI provider/model | TBD — open input | Adapter + fake provider until chosen; admin UI names are samples |
| Upload size/format/duration limits | Decided 2026-11-17 (US-032 plan) | Photo JPEG / PNG / WebP ≤ 10 MB; video MP4 / MOV with H.264 or HEVC ≤ 200 MB and ≤ 300 s (values from `AdmSetMedia`; length chosen by the user). Env config now (`MEDIA_MAX_*`), the Phase G admin screen later. No HEIC (sharp prebuilt cannot decode it), no transcoding (HEVC may not play on some Android WebViews; accepted) |
| Media storage in dev/test | Decided 2026-11-17 (US-032 plan) | `ObjectStorage` port in backend-core. `STORAGE_DRIVER=local` (default): files under `STORAGE_LOCAL_DIR`, HMAC-signed short-lived PUT/GET URLs served by the dev-only `/v1/dev-storage/*` (Range support; refused in production). `STORAGE_DRIVER=r2`: `@aws-sdk/client-s3` presigner against R2 once a dev bucket exists. Tests use the local driver in a temp dir; never production R2 |
| Media location metadata | Decided 2026-11-18 (US-032 plan) | The worker removes it before READY: photos re-encoded with sharp (auto-orient, no metadata, q90), videos remuxed `ffmpeg -map_metadata -1 -c copy`; the cleaned file replaces the original |
| Gallery "Media #N" | Decided 2026-11-18 (US-032 / US-035 plans) | Permanent per-creator `gallery_items.seq` (from `creators.last_gallery_seq`, assigned when the item enters the gallery). It is also the gallery order everywhere; admin "Cari media" matches it |
| Media processing | Decided 2026-11-17 (US-032 plan) | Outbox `media.uploaded` → BullMQ queue `media` in the worker (sharp + system ffmpeg/ffprobe via `FFMPEG_PATH` / `FFPROBE_PATH`); gallery item written only at READY; the Mini App polls asset status every 2 s (shortcut until a realtime event is needed); cleanup every 10 min of PENDING / FAILED > 24 h and unsent chat uploads |
| Product name, bot username, domains | TBD — open input | Placeholders only (design uses "Creator Chat", `CreatorChatBot` as samples) |
| Claude Design handoff location | Decided 2026-11-14 | `designs/creator-chat-design-handoff/design/` — see `design-integration.md` |
| Design vs brief conflicts (AI disclosure, AI memory, price, welcome message, blur gallery, timezone) | Decided 2026-11-14 | See "Resolved Conflicts" in `design-integration.md` |
| Telegram message notifications: presence | Decided 2026-11-21 (US-042) | No presence service. `message.created` events are claimed after a 30 s delay (`OutboxDispatcher.minAgeMs`); a notification is skipped when the recipient's read cursor already covers the message, and bursts are coalesced through `notification_state.last_notified_seq`. Deviation from brief §9 ("fresh presence"): a real Redis presence heartbeat remains a later option |
| Shared Telegram delivery runner | Decided 2026-11-21 (US-044) | `TelegramDeliveryRunner` + `NotificationRouter` (handlers per outbox event type) replace the single-purpose US-013 notifier; retries stay in PostgreSQL |
| Access reminder lead time | Decided 2026-11-21 (US-045) | 3 days before `ends_at`, `ACCESS_REMINDER_LEAD_DAYS`; scanner in the worker (60 s loop, transaction-scoped advisory lock) writes outbox events deduped per subscription period; ended notices look back 3 days. Built US-045 |
| Broadcast media | Decided 2026-11-21 (US-038) | One photo or video required, text optional; new upload purposes `BROADCAST` and `WELCOME`; "Simpan juga ke galeri" creates the gallery item at send time |
| Welcome message trigger | Decided 2026-11-21 (US-041) | Separate outbox event `welcome.requested` written by the grant that creates the subscription row; the switch is read at delivery (no retroactive welcome) |
| Per-creator mute UI | Open (design gap, 2026-11-21) | API and storage planned in US-042/US-043; the control stays unbuilt until the designer places "Bisukan" |

### Pinned Versions (2026-11-15)

Checked against the npm registry and each package's `peerDependencies`/`engines` (Node 24 on the dev machine). Pinned exactly in `package.json`; `pnpm-lock.yaml` is committed.

| Package | Version | Compatibility note |
|---------|---------|--------------------|
| Node / pnpm | 24.x / 12.16.1 | `engines.node >=24` |
| typescript | 6.0.3 | typescript-eslint 8.72.2 peers `<6.1.0`, so TS 7 is not used |
| @nestjs/common, core, platform-fastify, testing | 12.5.0 | ESM-only; platform-fastify bundles fastify 5.12.8 and @fastify/cors |
| prisma, @prisma/client, @prisma/adapter-pg | 7.10.1 | Node 24 supported; Prisma 7 needs `prisma.config.ts` and a driver adapter (`pg` 8.23.1). `prisma@8` is still rc, so not used |
| zod | 4.6.7 | |
| ioredis | 6.0.0 | |
| pino | 10.4.0 | |
| argon2 | 0.45.2 | native prebuild; build script approved in `pnpm-workspace.yaml` |
| react, react-dom | 19.3.1 | |
| vite / @vitejs/plugin-react | 8.3.8 / 6.3.0 | plugin-react 6 requires vite ^8 |
| vitest | 5.1.0 | peer vite ^6.4, ^7 or ^8 |
| unplugin-swc / @swc/core | 2.0.0 / 1.16.22 | |
| eslint / typescript-eslint | 10.15.0 / 8.72.2 | flat config |
| prettier | 3.10.1 | |
| tsx / concurrently | 4.23.15 / 9.2.1 | dev tooling only |
| react-router | 8.5.1 | Shell navigation (miniapp, admin); import `RouterProvider` from `react-router/dom` |
| @fontsource/inter | 5.3.0 | Self-hosted Inter, latin 400/500/600/700 |
| @playwright/test | 1.65.1 | Root devDependency, `pnpm visual`; Chromium installed locally |
| @testing-library/react / dom / user-event / jest-dom | 16.3.3 / 10.4.2 / 14.6.10 / 7.0.1 | Component tests |
| jsdom | 31.0.1 | Vitest environment |
| jose | 6.2.17 | Admin access JWT (HS256), in `packages/backend-core` (and as a test-only devDependency of `apps/api`); checked against the npm registry 2026-11-15 |
| @fastify/cookie | 11.1.5 | Cookie parsing/setting for the API (Fastify 5 compatible), `apps/api` |

| bullmq | 6.5.4 | US-013, `apps/worker`; ~2 weeks old (newest 6.7.6 was 4 days), peer `ioredis >= 5` accepts ioredis 6.0.0, Redis >= 5 (8.10 locally); connections use `maxRetriesPerRequest: null`. Its optional `msgpackr-extract` build script stays ignored |
| grammy | 1.46.0 | US-005 `apps/api` (webhook, `webhookCallback(bot, 'fastify')`); checked against the npm registry 2026-11-15 (engines node >=14.13); its types package is @grammyjs/types 5.0.0 |

Socket.IO installed (US-031): `socket.io` 4.8.4 and `@socket.io/redis-adapter` 8.3.0 (api), `@socket.io/redis-emitter` 5.1.0 (worker), `socket.io-client` 4.8.4 (miniapp), `pg` 8.23.1 (api, NOTIFY listener); the same four as test devDependencies where tests need them. Media installed (US-032): `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` 3.1161.0 (backend-core, R2 adapter; newest release older than two weeks at install, 2026-11-18), `sharp` 0.35.5 (worker). The workspace also records `msgpackr-extract: false` in `allowBuilds` (BullMQ's optional native accelerator; the JS fallback is used). Not yet installed: TanStack Query (its story). `backend-core` now also depends on `@creatorchat/db` (Prisma client types) and has `ioredis` as a test-only devDependency.

## Testing

- Typecheck + lint + build per changed package.
- Unit tests for pure domain logic (entitlement windows, state transitions).
- **Integration tests against real PostgreSQL** (separate test database) for authorization, idempotency, transactions and concurrency — these matter more than getter tests.
- Fakes for Telegram API, AI provider, and R2 by default. Real integrations only when explicitly configured.
- Visual QA: Playwright screenshots at board sizes (`INDEX.md`) compared with `design/png/...` — miniapp 390 wide; admin 1440, 1024, 390.

## Deployment

Out of scope until instructed. Later: VPS running all components, TLS, off-host PostgreSQL backups with tested restore. No automated deployment.

---

**Important**: All agents MUST follow `backend.md` and `frontend.md` when generating code, and the brief for product rules.
