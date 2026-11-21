# Technical Plan: US-038 — Creator composes and sends a broadcast

## Architecture Overview

Agreed with the user (2026-11-21): media required, text optional.

```
Pilih Galeri : gallery asset (READY, in my gallery) ─────────────┐
Upload Baru  : init {purpose: BROADCAST} → PUT → complete →      ├─▶ POST /v1/creator/broadcasts
               worker READY (no gallery item)                    │     {client_broadcast_id, attachment:{asset_id}, body?, save_to_gallery}
                                                                  └─ tx: replay check → asset lock + ownership → active-subscriber count
                                                                        → (save_to_gallery ⇒ one gallery item) → broadcasts row
                                                                        → outbox broadcast.created           (fan-out = US-039)
```

- The request records the broadcast and returns; delivery is the worker's job (US-039). Nothing is sent to any recipient inside the HTTP call.
- **Asset rules.** `GALLERY` asset: must be READY and have a gallery item of mine; reusable by any number of broadcasts (same object, new relation). `BROADCAST` asset (an "Upload Baru"): READY, mine, **not yet used** by a broadcast; one use only. `CHAT` / `WELCOME` assets → 404. `save_to_gallery: true` is valid only with a `BROADCAST` asset; it creates the gallery item in the same transaction (one asset, one gallery item, same object). With a gallery asset the field must be false (400 otherwise).
- New upload purposes `BROADCAST` and `WELCOME` (WELCOME is used by US-040 but the enum and init change ship together, once).
- Unsent uploads must not leak: cleanup extends to unused `BROADCAST` / `WELCOME` uploads (READY, unreferenced, older than 24 h) and **never** deletes an asset referenced by a broadcast, a welcome config or a message attachment.
- Zero active subscribers → 409 `NO_ACTIVE_SUBSCRIBERS` (gap: no board; the UI shows the placeholder toast "Belum ada subscriber aktif.").

Brief refs: §8C, §8D, §8E, §9, §14, §15. Design refs: `CrBroadcast`, `CrBroadcastPick`, `CrBroadcastReady`, `CrBroadcastUpload`, `CrBroadcastUploadSaved`, `CrBroadcastConfirm`, `CrBroadcastDone`.

## Authorization & Data Rules

- `@Roles('CREATOR')` on every route; USER → 403 `FORBIDDEN_ROLE`; blocked creator account or creator → 401 / 403 as the existing creator routes.
- Asset lookup always includes `creator_id = <caller's creator>` in the statement (`SELECT … FOR UPDATE OF a`): another creator's asset, unknown or malformed id → one identical 404 `MEDIA_NOT_FOUND`; not READY → 409 `MEDIA_NOT_READY`.
- Idempotency: `UNIQUE (creator_id, client_broadcast_id)`. Replay with the same asset + body + `save_to_gallery` → 200 with the stored broadcast; different content → 409 `IDEMPOTENCY_CONFLICT`. Replay runs before the active-subscriber check, so a retry after success never returns 409.
- Body: trimmed, 1–2000 code points when present; unknown keys → 400 (strict).
- Rate limit: `FixedWindowLimiter`, 10 / min per creator user, 429 `RATE_LIMITED`.
- One transaction: broadcast insert + optional gallery item + outbox event. Outbox payload = ids only (`broadcast_id`, `creator_id`), dedupe key `broadcast:<id>:created`.
- DB CHECKs: body length; FKs RESTRICT.

## Dependencies

- US-032 (upload pipeline, `useUploads`, gallery numbering), US-036 (gallery picker + attach flow, to be generalised), US-020 (active entitlement SQL in `subscription-access/entitlement-sql.ts`), US-013 (outbox). No new packages, no env.

## Risks

- **Picker reuse:** `creator-chat/attach` is chat-specific. TASK-226 extracts a neutral `MediaPicker` (list + select + Lanjut) used by chat, broadcast and welcome, keeping US-036 tests green.
- **Cleanup racing a send:** the send locks the asset row (`FOR UPDATE`) like chat send, so cleanup (which also locks) either sees the broadcast reference or deletes before the send finds it (→ 404).
- **Active count is advisory:** the real snapshot is taken by the worker (US-039); a count of 0 at send time only blocks pointless broadcasts.

## Tasks

### TASK-221: Migration — broadcasts and media purposes

Two migrations (Postgres cannot use a new enum value in the transaction that adds it; follow `20261201010000/…0100`):
1. `<next>_broadcast_enums`: `ALTER TYPE "MediaPurpose" ADD VALUE 'BROADCAST'; ADD VALUE 'WELCOME';` and `CREATE TYPE "BroadcastStatus" AS ENUM ('QUEUED','FANNING_OUT','COMPLETED')`, `CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING','DELIVERED','SKIPPED','FAILED')`.
2. `<next+1>_broadcast`:
   - `broadcasts`: `id uuid pk default gen_random_uuid()`, `creator_id uuid fk RESTRICT`, `client_broadcast_id uuid`, `asset_id uuid fk RESTRICT`, `body text null` (CHECK `body IS NULL OR char_length(body) BETWEEN 1 AND 2000`), `save_to_gallery boolean not null default false`, `status BroadcastStatus default QUEUED`, `snapshot_at timestamptz(3) null`, `recipient_count int null`, `created_at timestamptz(3) default now()`, `completed_at timestamptz(3) null`; `UNIQUE (creator_id, client_broadcast_id)`; index `(status, created_at)`; partial unique index on `asset_id` where the asset's purpose is BROADCAST is not expressible → enforced in the service under the asset lock.
   - `broadcast_recipients`: `id uuid default gen_random_uuid()` (used as the deterministic `client_message_id`), `broadcast_id fk`, `customer_id fk`, `status BroadcastRecipientStatus default PENDING`, `message_id uuid null fk`, `reason text null` (CHECK `^[a-z0-9_]{1,32}$`), `attempts int default 0`, `updated_at`; `PRIMARY KEY (broadcast_id, customer_id)`, `UNIQUE (id)`; CHECK `(status = 'DELIVERED') = (message_id IS NOT NULL)`; index `(broadcast_id, status)`.
   - `messages.broadcast_id uuid null fk RESTRICT` + `CREATE UNIQUE INDEX messages_broadcast_conversation_uq ON messages (broadcast_id, conversation_id) WHERE broadcast_id IS NOT NULL`.
3. Update `schema.prisma` (models, enums, relations on `Creator`, `User`, `MediaAsset`, `Message`) and regenerate the client.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/<ts>_broadcast_enums/migration.sql` | enum values |
| CREATE | `packages/db/prisma/migrations/<ts+1>_broadcast/migration.sql` | tables, CHECKs, indexes |
| MODIFY | `packages/db/prisma/schema.prisma` | models |

**Testing:**
- Migration applies on the test DB; CHECKs reject a 2001-char body, a DELIVERED row without message, a duplicate `(broadcast, conversation)` message.

---

### TASK-222: Contracts — broadcast and upload purposes

- `packages/contracts/src/broadcast.ts`: `createBroadcastRequest` (strict: `client_broadcast_id: uuid`, `attachment: {asset_id: uuid}`, `body?: trimmed string 1–2000 code points`, `save_to_gallery: boolean` default false), `broadcastResponse` (`{id, status, created_at}`), types.
- `media.ts`: upload-init `purpose` accepts `'GALLERY' | 'CHAT' | 'BROADCAST' | 'WELCOME'`; `conversation_id` stays required for CHAT only and **refused** for the others.
- `errors.ts`: add `NO_ACTIVE_SUBSCRIBERS` (409); reuse `MEDIA_NOT_FOUND`, `MEDIA_NOT_READY`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`.
- Export from `index.ts`; `broadcast.spec.ts`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/broadcast.ts` (+ `.spec.ts`) | request/response |
| MODIFY | `packages/contracts/src/media.ts`, `errors.ts`, `index.ts` | purposes, code, export |

**Testing:** schema cases: empty/whitespace body rejected, 2001 chars rejected, unknown key rejected, missing `client_broadcast_id` rejected, `conversation_id` with BROADCAST rejected.

---

### TASK-223: Backend-core — gallery helper, upload purposes, orphan cleanup

- Extract `addToGallery(tx, creatorId, assetId)` (increment `creators.last_gallery_seq`, insert `gallery_items … ON CONFLICT DO NOTHING`) from `MediaUploadService.markProcessed`; `markProcessed` calls it for `GALLERY` only (unchanged behaviour; BROADCAST / WELCOME become READY with no gallery item).
- `MediaUploadService.init`: accept `BROADCAST` / `WELCOME` (no conversation, no entitlement check; creator must be ACTIVE). `(creator, client_upload_id)` idempotency unchanged.
- Cleanup (`cleanupAbandoned`, ~line 393): add unused `BROADCAST` and `WELCOME` uploads — READY, `ready_at < cutoff`, **and** `NOT EXISTS` in `broadcasts.asset_id`, `message_attachments.asset_id` and `gallery_items.asset_id` (US-040 TASK-241 adds `creator_welcome_messages.asset_id` to the same clause). Deletes objects only after the state change is saved, as today.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/media/media-upload.service.ts` | helper, purposes, cleanup |
| MODIFY | `packages/backend-core/src/media/media-upload.service.int.spec.ts` | new cases |

**Testing:**
- BROADCAST upload init → complete → READY, **no** `gallery_items` row, no seq consumed.
- Cleanup deletes an unused 25 h old BROADCAST upload; keeps one referenced by a `broadcasts` row, one attached to a message, one in the gallery.
- GALLERY and CHAT behaviour unchanged (existing tests).

---

### TASK-224: Backend-core — `BroadcastService.create`

`packages/backend-core/src/broadcast/broadcast.service.ts`:
`create(creatorUserId, input: {clientBroadcastId, assetId, body?, saveToGallery}): Promise<{kind:'created'|'replayed', broadcast} | {kind:'media_not_found'|'media_not_ready'|'no_active_subscribers'|'conflict'|'invalid'|'not_found'}>`.
Single transaction: resolve my ACTIVE creator (+ user ACTIVE) → replay lookup on `(creator, client_broadcast_id)` → asset `FOR UPDATE` with the rules in the overview → `save_to_gallery` rule → active-subscriber count via `entitlement-sql` (customer ACTIVE, creator ACTIVE, `starts_at <= now < ends_at`, not revoked) = 0 → `no_active_subscribers` → `addToGallery` if requested → insert broadcast → `OutboxService.add(BROADCAST_CREATED …)`. Add `BROADCAST_CREATED: 'broadcast.created'` to `OutboxEventType`. Export from `index.ts`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/broadcast/broadcast.service.ts` (+ `index.ts`) | create |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | event type |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real DB):**
- Gallery asset → broadcast row, **no** new gallery item, no new object; same asset reused by a second broadcast.
- BROADCAST asset, `save_to_gallery` false → no gallery item; true → exactly one gallery item, same asset id.
- BROADCAST asset used twice → second 404; `save_to_gallery` with a gallery asset → `invalid`.
- Another creator's asset id / CHAT asset / WELCOME asset / malformed → `media_not_found`; PENDING asset → `media_not_ready`; zero active subscribers (only expired) → `no_active_subscribers`, nothing written.
- Replay same input → `replayed` (also when subscribers have expired meanwhile); changed body → `conflict`; two concurrent identical requests → one row.
- Blocked creator / blocked creator user → `not_found`, nothing written.

---

### TASK-225: API — `POST /v1/creator/broadcasts` and upload purposes

- `apps/api/src/modules/creator/creator-broadcast.controller.ts`: `@Controller('creator/broadcasts')`, `@UseGuards(UserJwtGuard, RolesGuard)`, `@Roles('CREATOR')`, `POST` (201 new / 200 replay), `Cache-Control: no-store`, Zod pipe with `createBroadcastRequest`, limiter 10/min per user, error mapping (`MEDIA_NOT_FOUND` 404, `MEDIA_NOT_READY` 409, `NO_ACTIVE_SUBSCRIBERS` 409, `IDEMPOTENCY_CONFLICT` 409, `RATE_LIMITED` 429).
- Register in `CreatorModule` (+ `BROADCAST` provider in `tokens.ts`); upload-init controller passes the new purposes through (CREATOR only, as today).
- `apps/api/test/roles-declared.spec.ts` must pass (route declares `@Roles`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creator/creator-broadcast.controller.ts` (+ int spec) | endpoint |
| MODIFY | `apps/api/src/modules/creator/creator.module.ts`, `tokens.ts` | wiring |
| MODIFY | media upload init controller (US-032) | pass-through of purposes |

**Testing (HTTP integration):** USER → 403; unauthenticated → 401; blocked creator → 401; replay 200; conflict 409; unknown key 400; 11th request within a minute 429; IDOR (another creator's asset) 404 identical to unknown id.

---

### TASK-226: Mini App `/broadcast` composer

Replace the `/broadcast` placeholder (creator shell, bottom nav "Broadcast" highlighted) with the flow of boards `CrBroadcast` → `CrBroadcastPick` → `CrBroadcastReady` / `CrBroadcastUpload` / `CrBroadcastUploadSaved` → `CrBroadcastConfirm` → `CrBroadcastDone` (states of one route, in-page steps, Telegram BackButton steps back).
- Extract `apps/miniapp/src/creator-chat/attach` list/select logic into `apps/miniapp/src/media-picker/MediaPicker.tsx` (props: `onPick(asset)`, title copy); `AttachFlow` uses it; existing attach tests pass.
- `apps/miniapp/src/broadcast/`: `BroadcastPage.tsx`, `useBroadcast.ts` (state: media `{source: 'GALLERY'|'UPLOAD', asset}`, `body`, `saveToGallery`, `clientBroadcastId = crypto.randomUUID()` created once per composed broadcast and kept across retries), `broadcast-copy.ts` (all strings verbatim from the boards), `broadcast.module.css` (values from the HTML files).
- Upload Baru: reuse `useUploads` with `purpose: 'BROADCAST'`, progress/failed placeholders as US-036; "Simpan juga ke galeri" checkbox default off with the two notes verbatim.
- Kirim Broadcast disabled until media chosen (and while an upload is not READY); opens the confirm dialog; Batal returns; confirm sends, disables the buttons in flight; success → reset to the empty composer + dark toast "Broadcast terkirim ke semua subscriber aktif". Failure (network / 5xx / 409): inline error, **media, text and checkbox kept**, retry reuses the same `client_broadcast_id`; `NO_ACTIVE_SUBSCRIBERS` → toast "Belum ada subscriber aktif." (placeholder, gap).
- A USER is redirected to `/chats` (existing role routing).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/broadcast/*` | page, hook, copy, styles, specs |
| CREATE | `apps/miniapp/src/media-picker/MediaPicker.tsx` | shared picker |
| MODIFY | `apps/miniapp/src/creator-chat/attach/*` | use shared picker |
| MODIFY | router (`apps/miniapp/src/app`) | `/broadcast` route |
| MODIFY | contracts client (`apps/miniapp/src/...api`) | `createBroadcast` |

**Testing (component):** each board state renders; Kirim disabled without media; checkbox default off and note swaps; confirm → one request with the right body (`save_to_gallery` true/false); double tap sends once; failure keeps input; Batal sends nothing; picker still works in chat attach.

---

### TASK-227: Visual check and docs

- Playwright (`pnpm visual`) at 390 × 844 / 940 for `CrBroadcast`, `CrBroadcastPick`, `CrBroadcastReady`, `CrBroadcastUpload`, `CrBroadcastUploadSaved`, `CrBroadcastConfirm`, `CrBroadcastDone`; fix differences; note placeholder illustrations.
- `codebase-map.md` (routes, tables, endpoint, purposes), `design-integration.md` Known Gaps (zero subscribers, composer upload failure, creator-side broadcast label).

**Testing:** screenshots reviewed; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
