# Backend Development Guidelines

Covers `apps/api`, `apps/worker`, `packages/db`, `packages/contracts`, `packages/backend-core`.
Product rules: `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` (cited below as brief §N), **as amended by the resolved conflicts in `.agile/guidelines/design-integration.md`** (no AI memory/summaries, welcome message, display-only creator price, creator timezone, no gallery tiles for non-subscribers). Where they differ, design-integration.md wins; otherwise the brief wins.

## Overview

NestJS + Fastify API and a BullMQ worker, as a **modular monolith** over PostgreSQL (Prisma). Business logic that both processes need (entitlement checks, message commit, AI commit, media authorization, outbox writes) lives in `packages/backend-core` as plain TypeScript services that take a Prisma client/transaction — not inside Nest controllers.

## Project Structure

```
apps/api/src/
├── main.ts                     # Fastify adapter, CORS allowlist, cookies, Socket.IO adapter
├── app.module.ts
├── common/
│   ├── auth/                   # TelegramSessionGuard, AdminJwtGuard, RolesGuard, @CurrentUser, @CurrentAdmin
│   ├── errors/                 # AppError + global exception filter -> { code, message, request_id }
│   ├── request-id/             # request ID middleware (propagated to logs + audit)
│   ├── validation/             # pipe that validates with packages/contracts schemas
│   └── rate-limit/
├── modules/                    # One folder per business capability (user-facing, /v1)
│   ├── auth/                   # telegram initData -> session, me, logout
│   ├── profile/
│   ├── creators/               # explore, public creator profile
│   ├── creator-applications/
│   ├── access/                 # access requests (TRIAL/RENEWAL), my subscriptions
│   ├── conversations/          # list, messages, read cursor, mode (AI/MANUAL)
│   ├── media/                  # upload init/complete, signed access
│   ├── gallery/
│   ├── broadcasts/
│   ├── persona/                # creator persona (versioned)
│   ├── creator-settings/       # welcome message, subscription price (display only), timezone
│   ├── notifications/          # preferences
│   ├── realtime/               # Socket.IO gateway
│   └── telegram-webhook/       # grammY webhook handler (fast; enqueue work)
└── admin/                      # /v1/admin — separate guards, never mixed with user modules
    └── admin-auth/ creators/ users/ access/ audit/ ai/ settings/ dashboard/

apps/worker/src/
├── main.ts                     # Nest standalone application context or plain bootstrap (decide at scaffold)
├── processors/                 # ai-reply, media-process, broadcast-dispatch, notification-send, access-reminder
└── outbox/                     # reconciler: pending OutboxEvent -> queue

packages/backend-core/src/      # <capability>/<capability>.service.ts — framework-light, used by api + worker
packages/contracts/src/         # <capability>.ts — schemas + inferred types, error codes, socket events
packages/db/                    # prisma/schema.prisma, prisma/migrations/, src/client.ts, seed/
```

### Module layout (per capability)
```
modules/conversations/
├── conversations.module.ts
├── conversations.controller.ts   # thin: validate -> call service -> map to contract
├── conversations.service.ts      # orchestration; delegates rules to backend-core
└── conversations.*.spec.ts
```

- Controllers are thin. No Prisma calls in controllers.
- Request/response shapes come from `packages/contracts` — the same schema validates the request at runtime and types the frontend client. No hand-duplicated DTO types.
- Map DB rows to contract shapes explicitly (no mapping library). Never return Prisma models directly — it leaks fields (R2 keys, hashes, internal flags).

## Data Model Rules (brief §13)

- UUID primary keys, `timestamptz` everywhere (UTC). Display timezone is IANA, from settings.
- `User.telegram_id` is `BigInt` UNIQUE, serialized as string. Username is mutable, never an identity.
- Explicit enums: `Role {USER, CREATOR}`, `AccountStatus {ACTIVE, BLOCKED}`, `ApplicationStatus {PENDING, APPROVED, REJECTED}`, `AccessRequestType {TRIAL, RENEWAL}`, `ConversationMode {AI, MANUAL}`, message origin (customer / creator manual / AI / broadcast), technical upload state.
- DB-enforced uniqueness for every idempotency key: `(conversation_id, client_message_id)`, AI result job key, `(broadcast_id, customer_id)`, notification dedupe key, `(creator_id, asset_id)` gallery item.
- One pending `CreatorApplication` per user → partial unique index (raw SQL in the migration if Prisma can't express it).
- Indexes follow real query paths: messages `(conversation_id, created_at, id)`; subscriptions `(creator_id, ends_at)`; outbox/notification `(status, available_at)`; admin lists by status/time. No speculative indexes.
- `GalleryItem` and `MessageAttachment` are separate from `MediaAsset`. Removing a gallery membership never deletes a still-referenced object.
- `Broadcast` has **no** `scheduled_at`. No tables for cancelled features (brief §20).
- `AuditLog` and `SubscriptionEvent` are append-only (no update/delete code paths).
- **Not in the model** (design decision #3): `ConversationMemory`, `ConversationSummary`.
- **Added by design decisions:** creator `subscription_price` (IDR integer, display only) and an app-fee percentage in platform settings (placeholder 10%, not hardcoded); `WelcomeMessage` per creator (enabled, body, optional asset ref, version) plus a unique delivery key per `(creator_id, customer_id)`; display `timezone` (IANA) per account; AI monthly budget in AI config.
- No payment/checkout/payout/revenue tables, even though a price exists.

### Migrations
- `prisma migrate dev` only against the local dev DB. Commit every migration.
- Never `migrate reset` / drop on a database you didn't create for this task.
- Seeds are explicit fixtures. Initial admin via CLI/seed using a supplied secret or a generated password shown once — never a default password in the repo.

## Authorization — Hard Rules (blocker if violated)

Assume every caller-supplied ID (route, body, query, socket payload) may belong to someone else.

1. **Identity comes from the session**, never from the client. Ignore `userId`, `role`, `telegramId` sent in a body. Never trust `initDataUnsafe`.
2. **Every query taking a caller-supplied ID is scoped** by the current principal, e.g. `conversation.findFirst({ where: { id, customerId: me.id } })` — not `findUnique({ id })` followed by a check that can be forgotten. A wrong-owner ID returns **404**.
3. **Role is checked in the backend on every route** (`USER` vs `CREATOR`; admins are a separate principal type). Hiding a menu is not authorization.
4. **Session freshness:** sensitive operations and socket joins re-check `User.status` and `session_version`. Block or role change bumps `session_version` → stale sessions lose privileges.
5. **Active entitlement** (brief §6) uses DB time: `starts_at <= now() < ends_at AND revoked_at IS NULL AND customer ACTIVE AND creator ACTIVE`. Check it on: sending a message, enqueuing and committing AI, gallery listing and gallery media URL issuance, broadcast recipient snapshot **and** per-recipient delivery. The UI is never the authority.
6. **Media read access** (brief §8E): allowed only for (a) the owning creator, (b) an active subscriber via a gallery membership, or (c) the recipient of a message attaching the asset (survives expiry). Signed URLs are issued only after this check. Never expose R2 keys or permanent URLs; never use upload location as authorization.
7. **Attach validation:** only the owning creator can attach an asset, and only once its upload is finalized.
8. **Admin scope** (`/v1/admin`) uses `AdminJwtGuard` only; user sessions can never reach it, admin tokens can never act as users.
9. **CREATOR cannot hold customer access:** approval transactionally re-checks no active or future subscription exists; grant rejects role CREATOR; creator applications are blocked while the user has an active subscription (brief §5).

## Telegram Auth (brief §3)

- Validate `initData` HMAC with the bot token, check `auth_date` max age, then parse the user payload.
- Upsert `User` by `telegram_id`; new accounts are always `USER`. Telegram name/photo seed the app profile only on creation.
- Issue an app session (short-lived token + server-side `Session` row). The Mini App keeps it in memory and re-exchanges `initData` on launch — no localStorage tokens.
- `start` parameters (`c_<public_code>`) only select a destination; they grant nothing.
- Never log the bot token or raw `initData`.

## Admin Auth (brief §3, §11)

- Argon2id password hashes. Short-lived access JWT + rotating, revocable refresh token (hashed in `Session`).
- Secure/HttpOnly cookies, SameSite per topology, CSRF protection, explicit CORS allowlist.
- Rate-limit login; generic error message on failure. No public registration.

## Chat, AI and Concurrency (brief §7)

- **Persist first:** a message is written in a DB transaction before any ack or socket emit. Socket events are emitted only after commit.
- Customer sends carry `client_message_id`; retries return the existing message (unique constraint), never a duplicate.
- `Conversation.response_version` increments on every mode change and manual send; the plan for the AI story must define one consistent strategy for inbound messages arriving during generation (bump version + re-enqueue, or merge into context) — never commit a reply built on a stale snapshot.
- AI jobs are serial per conversation and idempotent (unique AI job key on the result message).
- **AI commit protocol:** in one transaction: lock the conversation (`SELECT ... FOR UPDATE`) → verify `mode = AI`, `response_version` equals the job snapshot, customer + creator ACTIVE, subscription active → insert message → write outbox → commit. Any check fails → discard result and record the outcome. Do not rely on queue cancellation.
- Manual send by the creator atomically sets mode `MANUAL` and bumps the version. Re-enabling AI is explicit only; global AI config never re-enables manual conversations.
- AI provider behind an adapter interface with a fake implementation for dev/tests. Persona is versioned (creator edits and admin edits with reason both create a version; admin edits are audited).
- **AI context = current persona version + a bounded window of recent messages from this conversation only.** No per-customer memory, no summaries, never any data from other conversations or creators.
- AI never claims real-world activities or promises meetings (persona boundaries + system rules).
- Customer-facing API responses never expose message origin (AI/manual); origin is returned only on creator/admin endpoints.
- Enforce the AI config limits: output token cap, timeout, retry limit, and monthly budget (notify at 80%, stop generating at 100% — conversations then surface as AI failure/needs manual reply in the creator inbox).
- AI failure surfaces in the creator inbox with retry / reply manually. Never fabricate a reply.
- `AIUsage` records tokens, model, estimated cost (tariff source + timestamp), latency, outcome — never chat content.

## Outbox, Queues and Worker (brief §14)

- A business transaction writes an `OutboxEvent`; a dispatcher enqueues to BullMQ after commit; a reconciler re-enqueues stale pending events. Redis is never the durable store.
- Every processor is idempotent and safe to run twice. Queue success ≠ business success — record outcome in the DB.
- Broadcast: confirm → snapshot recipients at dispatch start (`BroadcastRecipient`, unique per customer) → per-recipient transaction re-checks entitlement and creates exactly one message → notification. Broadcast never triggers AI by itself.
- Notifications: `NotificationDelivery` with unique dedupe key; respect Telegram `retry_after`/backoff; mark bot-blocked users and stop retrying; coalesce bursts; respect per-creator mute and the hidden-preview default; skip when fresh presence says the chat is visible. A failed notification never affects the stored message. Don't claim exactly-once on ambiguous Telegram timeouts.
- Access reminder/expiry jobs are not media scheduling.

## Welcome Message (design decision #5)

- Triggered by the **first** access grant for a customer–creator pair (outbox event from the grant transaction). Not sent on extend, renew, or re-grant after expiry.
- Idempotent: unique delivery key per `(creator_id, customer_id)`; at most one welcome message ever per pair.
- Delivered in a transaction that re-checks active entitlement and that the welcome message is enabled; uses the content version current at delivery.
- Stored as a normal creator message (origin recorded internally as welcome), shown to the customer without any label, and **does not change** conversation mode or `response_version`, and does not trigger AI.
- Media: "Pilih Galeri" references the same gallery asset; "Upload Baru" is an attachment-only asset (never a GalleryItem), reused by reference for every recipient.

## Creator Price (design decision #4)

- `subscription_price` is a creator setting shown in `CrPrice`/`CrSettings`; the breakdown uses the platform app-fee setting. Pure display/settings — **no billing, checkout, invoices, payouts, or revenue aggregation**, and nothing in admin shows revenue.

## Media (brief §8)

- Upload flow: `init` (validate size/type against settings, create pending `MediaAsset` owned by the creator) → client uploads to R2 via a presigned PUT → `complete` (server verifies real MIME/size, worker builds thumbnail/poster) → finalized. Abandoned pending uploads are cleaned up; never delete an object still referenced.
- Chat "Upload Baru" → message attachment only, **never** a `GalleryItem`.
- Broadcast "Upload Baru" → `GalleryItem` only if `saveToGallery === true` (default false). Picking from the gallery reuses the same asset (new relation, no object copy, no save checkbox).
- No content-hash dedup, no blur previews, no public bucket, no HLS.

## HTTP Conventions

- Prefix `/v1`; plural kebab-case resources (`/v1/creator-applications`).
- Runtime validation of params/query/body with contract schemas; payload size limits.
- Errors via `AppError(code, httpStatus, message)` → global filter → `{ code, message, request_id }`. Error codes are constants in `packages/contracts`. Never leak stack traces or Prisma errors.
- Chat history: cursor pagination on `(created_at, id)`.
- Admin lists: server-side search/filter/sort with an **allowlist** of sort fields, `page` + `pageSize ∈ {10,25,50}`, return `{ items, total, page, pageSize }`.
- Every admin mutation writes `AuditLog` (actor, target, action, reason where required, sanitized before/after, request ID) in the same transaction.
- Secrets saved via admin settings are encrypted with the master key; read APIs return only "is set"/masked hints; an empty secret field on update means "keep existing".
- Test-connection endpoints never fetch arbitrary user-supplied URLs (SSRF); endpoints must match allowed shapes.

## Realtime (Socket.IO)

- Auth on connect with the same session rules; rooms (`user:<id>`, `conversation:<id>`) are derived server-side after an ownership check.
- Events: `message.created`, `conversation.updated`, `read.updated`, `typing.changed` (+ broadcast progress only if the design needs it). Event payload types live in `packages/contracts`.
- Presence is ephemeral (Redis), never a table. Clients recover missed messages over HTTP after reconnect.

## Logging & Security (brief §15)

- Structured logs with request ID. Never log passwords, tokens, keys, raw initData, or message content.
- Rate-limit: Telegram auth, admin login, message sends, uploads, AI enqueue.
- Content is rendered as text only. Parameterized queries only (`$queryRaw` with tagged templates, never string concatenation).
- No server secret in any `VITE_*` variable.

## Coding Standards

- `strict` TypeScript, no `any` (use `unknown` + narrowing).
- `async/await` everywhere; pass Prisma transaction clients (`tx`) explicitly into backend-core services.
- Filenames kebab-case (`creator-applications.service.ts`); classes PascalCase; functions camelCase.
- DI through Nest providers; backend-core services are wrapped as providers in api and instantiated in worker.
- Packages expose a single public entry; no deep imports into another package's internals.

## Testing

- **Unit:** pure logic in backend-core (entitlement window, state transitions, cost estimation) — `*.spec.ts` next to the file.
- **Integration (priority):** `*.int.spec.ts` against a real test PostgreSQL database (Compose), covering:
  - forged/expired initData rejected; admin auth independent of Telegram auth
  - IDOR: changed IDs never expose another user's conversation/message/media/admin data
  - approval converts the same account and blocks active/future subscription conflicts; stale session loses role
  - expiry blocks send/gallery but keeps received attachments readable
  - duplicate `client_message_id` / broadcast retry → exactly one DB message
  - AI commit refused after takeover, version change, or revoked access (concurrent transactions)
  - chat upload never enters gallery; broadcast opt-in; gallery reuse without object copy
  - non-subscriber creator profile/gallery endpoints return no media data at all
  - welcome message sent exactly once on first grant, not on extend/re-grant, and doesn't change AI mode
  - customer endpoints never reveal message origin (AI/manual)
- Fakes for Telegram Bot API, AI provider and R2. Tests never call paid AI, real Telegram audiences, or production R2.
- Test names describe behavior: `it('rejects AI result when creator took over during generation')`.

### Running
```bash
pnpm --filter api test
pnpm --filter backend-core test
pnpm test
```
Exact commands are finalized at scaffold — update this section when they exist.
