# Technical Plan: US-036 — Creator sends a photo or video in chat

## Architecture Overview

Vertical slice: migration (MEDIA messages, `message_attachments`, chat-only assets bound to one conversation) → contracts (creator send with attachment; message shape with attachments on both sides; list/inbox media preview) → backend-core (upload purpose CHAT, send with attachment under the conversation lock, histories return attachments, cleanup of unsent chat uploads) → API → Mini App attach flow (`CrAttach` → `CrChatPick` / Upload Baru → `CrChatPreview` / `CrChatUpload` → `CrChatSent`).

```
Pilih Galeri: gallery asset (READY, my gallery) ──────────────┐
Upload Baru : init {purpose: CHAT, conversation_id} → PUT →    ├─▶ POST /v1/creator/conversations/:id/messages
              complete → worker READY (no gallery item)        │      {client_message_id, body?, attachment: {asset_id}}
                                                                └─ tx: lock conversation → replay check → entitlement
                                                                       → attachment check → message (MEDIA) + message_attachments
                                                                       + outbox message.created
```

Brief refs: §6, §7 (creator sends text, photo, video), §8B, §8E (validate asset ownership before attach; chat uploads cannot be guessed and reused), §14, §17 ("Chat upload never enters gallery … gallery reuse does not duplicate object"; "retries create one persisted message"). Design refs: `CrAttach`, `CrChatPick`, `CrChatPreview`, `CrChatUpload`, `CrChatSent`, `CrMain`.

Defaults applied (flag if you disagree):

- **One attachment per message** (`CrChatPick`: "Pilih satu foto atau video dari galeri."). The table still has a `position` column so the shape matches brief §13 ("message + asset, order").
- **Chat-only uploads are bound at `init`** to one conversation (`media_assets.purpose = CHAT`, `conversation_id`). They can be attached only in that conversation and only once; they never get a gallery item. Unsent ones (READY, no attachment after 24 h) are deleted by the cleanup loop.
- **Message shape change on both sides now**: `type: 'TEXT' | 'MEDIA'`, `body: string | null`, `attachments: [{ id, kind, duration_seconds, thumbnail_url }]`. The customer history returns attachments from this story on, because the customer schema would otherwise reject MEDIA rows. The customer bubble, viewer and attachment URL endpoint are US-037, so **US-036 and US-037 ship together** (run them back to back).
- **List / inbox preview for a media-only message**: `last_media_kind: 'PHOTO' | 'VIDEO' | null`; the UI shows the placeholder words "Foto" / "Video" (not designed, gap).
- **Phase F text omitted**: "Mengirim akan mengambil alih percakapan dari AI." and the Manual / Aktifkan AI panel of `CrChatSent` are not shown until AI exists.
- **Creator media bubble is not tappable** in this story (no creator chat viewer is in the story; gap noted). The gallery viewer (US-033) covers the creator's own gallery media.
- **Attach flow is in-page state** (a sheet and full-screen steps over the conversation), not new routes; the Telegram BackButton steps back one level.

## Authorization & Data Rules

- Send: `@Roles('CREATOR')`, conversation scoped by `creators.user_id = me` (existing 404 rules). Under `SELECT … FOR UPDATE` of the conversation:
  1. Replay: same `(conversation, sender, client_message_id)` → if body **and** attachment asset id are equal → return the stored message (200), else 409 `IDEMPOTENCY_CONFLICT`. Replay runs before the entitlement check (decision US-026).
  2. Entitlement (customer entitled, creator ACTIVE) → else 403 `CHAT_ACCESS_EXPIRED`, nothing stored.
  3. Attachment: asset with `creator_id = mine`. Not found, another creator's, a CHAT asset of another conversation, a CHAT asset already attached, or a GALLERY-purpose asset without a gallery item → 404 `MEDIA_NOT_FOUND`. Found but not READY → 409 `MEDIA_NOT_READY`.
  4. Insert message (`type MEDIA`, `origin MANUAL`, body trimmed or NULL), `message_attachments` row, `last_message_at`, `last_message_seq`, outbox `message.created` (ids only).
- Upload init with `purpose: CHAT`: `conversation_id` required and must be my conversation (404 otherwise) with an entitled customer (403 `CHAT_ACCESS_EXPIRED`), so uploads cannot be parked in an ended chat.
- Worker: READY for a CHAT asset sets metadata only (no gallery item, no seq).
- DB: `MessageType` gains `MEDIA`; `body` nullable with CHECK `type = 'MEDIA' OR body IS NOT NULL` and the existing length CHECK applied only when not null; `media_assets` CHECK `(purpose = 'CHAT') = (conversation_id IS NOT NULL)`; FKs RESTRICT everywhere, so an attached asset can never be deleted.
- Rate limit: the existing media init limiter covers chat uploads too.

## Dependencies

- US-032 (upload pipeline, worker, cleanup loop, `GalleryTile`, `useUploads`), US-029 / US-026 (send + history + `useThread` / `ChatThread`), US-031 (realtime `message.created` already signals both sides), US-030 (read cursors unaffected).

## Risks

- **Customer UI before US-037**: a MEDIA message without the US-037 bubble would render as an empty bubble → ship together; the US-037 plan adds the bubble.
- **Optimistic bubble for a media send** needs the thumbnail: the attach flow already holds the READY asset view (with `thumbnail_url`), so the unsent bubble uses it.
- **Changing the shared message schema** touches US-026/029/030/031 tests → update fixtures in the same task; run the whole suite.

## Tasks

### TASK-207: Migration — MEDIA messages, attachments, chat-only assets

Migration `20261201010000_chat_media` (+ `schema.prisma`):
- `ALTER TYPE "MessageType" ADD VALUE 'MEDIA'`; `ALTER TYPE "MediaPurpose" ADD VALUE 'CHAT'` (separate statements; enum value additions cannot run inside the same transaction as their use).
- `messages.body DROP NOT NULL`; replace the body CHECK: `body IS NULL OR char_length(btrim(body)) BETWEEN 1 AND 2000` (keep the existing code-point semantics of the current CHECK) and add `type = 'MEDIA' OR body IS NOT NULL`.
- `media_assets.conversation_id uuid NULL REFERENCES conversations(id) ON DELETE RESTRICT`; CHECK `(purpose = 'CHAT') = (conversation_id IS NOT NULL)`.
- `message_attachments`: `id uuid pk`, `message_id fk messages RESTRICT`, `asset_id fk media_assets RESTRICT`, `position smallint NOT NULL DEFAULT 0`, `created_at`. UNIQUE `(message_id, position)`; index `(asset_id)` (recipient access lookups, "already attached" check).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/20261201010000_chat_media/migration.sql` | Schema change |
| MODIFY | `packages/db/prisma/schema.prisma` | `MessageAttachment`, enum values, nullable body, `MediaAsset.conversationId` |
| MODIFY | `packages/db/src/media.int.spec.ts` | Constraint tests |

**Testing:** TEXT with NULL body rejected; MEDIA with NULL body accepted; body of 2001 code points rejected; CHAT asset without conversation rejected, GALLERY asset with one rejected; deleting an attached asset / message refused; existing seed still loads.

---

### TASK-208: Contracts — attachments, media send, previews

- `chat.ts` (customer): `ChatAttachmentSchema = z.strictObject({ id: z.uuid(), kind: MediaKindSchema, duration_seconds: z.int().nullable(), thumbnail_url: z.url() })`; `ChatMessageSchema.type` → `z.enum(['TEXT', 'MEDIA'])`, `body: z.string().nullable()`, `attachments: z.array(ChatAttachmentSchema)` (empty for TEXT). `SendMessageBodySchema` (customer) unchanged: text only.
- `creator-chat.ts`: `CreatorChatMessageSchema` gets the same `type` / `body` / `attachments`. `CreatorSendMessageBodySchema` becomes its own schema: `{ client_message_id: uuid, body?: trimmed 1–2000 | omitted, attachment?: { asset_id: uuid } }`, refine "body or attachment" (both allowed; neither → 400).
- `media.ts`: `MediaUploadInitBodySchema` gains `purpose: z.enum(['GALLERY', 'CHAT']).default('GALLERY')` and `conversation_id: z.uuid().optional()` (refine: required iff CHAT).
- Chat list item (`ChatListItemSchema`) and inbox row: add `last_media_kind: MediaKindSchema.nullable()`.
- Error code `MEDIA_NOT_READY` (409).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/chat.ts`, `creator-chat.ts`, `creator-inbox.ts`, `media.ts`, `errors.ts` (+ specs) | Shapes |

**Testing:** customer send still rejects `attachment`; creator send with neither body nor attachment → invalid; with attachment only → valid; CHAT purpose without `conversation_id` → invalid; TEXT message with attachments in the history schema is allowed only as an empty array (refine).

---

### TASK-209: Backend-core — chat uploads, media send, attachments in history

- `MediaUploadService.init`: CHAT purpose → load my conversation (`FOR SHARE`), 404 if not mine, 403 `CHAT_ACCESS_EXPIRED` if the customer is not entitled; store `conversation_id`. `markProcessed`: CHAT → READY without a gallery item. `cleanup`: also delete CHAT assets READY > 24 h with no `message_attachments` row (`NOT EXISTS`, rows locked `SKIP LOCKED`; re-check `NOT EXISTS` inside the delete statement so a send racing the cleanup wins).
- `CreatorChatService.send(creatorUserId, conversationId, { clientMessageId, body?, attachmentAssetId? })`: the steps in "Authorization & Data Rules"; new outcomes `media_not_found`, `media_not_ready`. Keep one transaction.
- Shared `attachmentsFor(tx, messageIds): Map<messageId, AttachmentRow[]>` (one query joining READY assets) used by `CreatorChatService.history` and `ChatService.history` (customer); thumbnails signed through `MediaAccessService.thumbnailUrl` (the history queries are already scoped to the caller's conversation, which is the recipient check).
- Chat list (`chat-list.service.ts`) and inbox (`creator-inbox.service.ts`): preview from `body` (NULL → NULL) plus `last_media_kind` from the last message's attachment.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/media/media-upload.service.ts` (+ int spec) | CHAT purpose, cleanup |
| CREATE | `packages/backend-core/src/media/attachments.ts` | `attachmentsFor` |
| MODIFY | `packages/backend-core/src/creator-chat/creator-chat.service.ts` (+ int spec) | Send with attachment, history |
| MODIFY | `packages/backend-core/src/chat/chat.service.ts`, `chat-list.service.ts` (+ int specs) | Customer history attachments, preview |
| MODIFY | `packages/backend-core/src/creator-inbox/creator-inbox.service.ts` (+ int spec) | Inbox preview |

**Testing (integration):**
- Gallery pick: send → one message, one attachment row pointing at the **same** asset id; `media_assets` and `gallery_items` counts unchanged; no storage write.
- Chat upload: READY with no gallery item; attach in its own conversation → ok; the same asset again (second message) → `media_not_found`; in another conversation of the same creator → `media_not_found`; another creator's asset → `media_not_found`; PROCESSING → `media_not_ready`.
- Retry: same `client_message_id` + same asset → stored message, one row; same id + other asset → 409.
- Customer expired / revoked → 403, nothing stored (message, attachment and outbox counts unchanged).
- Concurrency: two sends of the same chat asset with different ids in parallel → exactly one succeeds.
- Cleanup removes an unsent chat upload after 24 h and never one that is attached.
- Customer history and chat list: MEDIA message with attachments; list preview NULL + `last_media_kind`.
- Worker: CHAT asset → READY, no gallery item (processor test from US-032 extended).

---

### TASK-210: API — creator send with attachment, chat upload init

- `POST /v1/creator/conversations/:id/messages` validates with the new `CreatorSendMessageBodySchema`; maps `media_not_found` → 404 `MEDIA_NOT_FOUND`, `media_not_ready` → 409 `MEDIA_NOT_READY`.
- `POST /v1/creator/media/uploads` accepts `purpose` / `conversation_id`; maps the conversation outcomes (404 `NOT_FOUND`, the code the creator chat already uses for a foreign conversation / 403 `CHAT_ACCESS_EXPIRED`).
- History responses include `attachments`; customer endpoints never include `origin` (unchanged) nor asset ids / keys (attachment ids only).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/creator/creator-chat.controller.ts` | Body + error mapping |
| MODIFY | `apps/api/src/modules/media/creator-media.controller.ts` | CHAT purpose |
| CREATE | `apps/api/test/creator-chat-media.int.spec.ts` | HTTP tests |
| MODIFY | existing chat / inbox / list API tests | Fixture shape updates |

**Testing:** HTTP versions of the IDOR and retry cases above; USER token on creator send → 403; a customer sending `attachment` → 400 (strict schema); customer history JSON keys (no `origin`, no `asset_id`, no object key).

---

### TASK-211: Mini App attach flow

`apps/miniapp/src/creator-chat/attach/`:
- `AttachSheet.tsx` (`CrAttach`): title "Kirim media ke {nama}", options **Pilih Galeri** / "Memakai file yang sama, tanpa salinan" and **Upload Baru** / "Hanya tersimpan di percakapan ini, tidak masuk galeri" (values and icons from the HTML). Opened by the composer's "Lampirkan media" button (add it to the creator composer; hidden when the composer is replaced by the expired panel).
- `PickFromGallery.tsx` (`CrChatPick`): full-screen, "Pilih Galeri" header, hint "Pilih satu foto atau video dari galeri.", `GalleryTile` grid from `useGallery` (US-032) with single selection (`selected`), bottom bar "1 media dipilih" + Lanjut (disabled with none). Empty gallery → the `CrStatesGallery` empty text without the Upload button (gap: no board for an empty picker).
- `upload-media.ts`: extract the init → PUT → complete → poll steps from US-032's `useUploads` into a reusable function with a `purpose` option; `useUploads` keeps using it.
- `SendPreview.tsx` (`CrChatPreview` / `CrChatUpload`): "Kirim ke {nama}", media preview (thumbnail; while uploading the `GalleryTile` uploading state with %), Ganti (back to the sheet), optional pesan field (same limits as text), the storage note ("Memakai media yang sama dari galeri. Tidak ada salinan baru." or "Media ini hanya tersimpan di percakapan ini. Tidak masuk ke galeri dan tidak tersedia untuk pelanggan lain."), Kirim (enabled when the asset is READY). Upload failure → the US-032 failure tile + Coba Lagi.
- `useAttachFlow.ts`: state machine `closed → sheet → pick | uploading → preview → sending`; Telegram BackButton goes back one step; leaving the conversation discards it (the cleanup loop removes the unsent upload).
- Kirim → `useCreatorChat` send with `attachment` (the unsent bubble keeps the asset view so Kirim Ulang resends the same `client_message_id` + asset) → close the flow → toast "Media terkirim".

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/creator-chat/attach/AttachSheet.tsx`, `PickFromGallery.tsx`, `SendPreview.tsx`, `useAttachFlow.ts`, `attach.module.css`, `attach-copy.ts` (+ specs) | Flow |
| CREATE | `apps/miniapp/src/gallery/upload-media.ts` | Shared upload steps |
| MODIFY | `apps/miniapp/src/gallery/useUploads.ts` | Use `upload-media.ts` |
| MODIFY | `apps/miniapp/src/creator-chat/CreatorChatPage.tsx`, `useCreatorChat.ts`, `apps/miniapp/src/chat/ChatThread.tsx` (composer attach button) | Wiring |
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec) | Send body, upload purpose |

**Testing:** gallery path sends `attachment.asset_id` of the picked item and never calls the upload API; upload path calls init with `purpose: 'CHAT'` and the conversation id; Kirim disabled until READY; failed send keeps the media and Kirim Ulang reuses the id; BackButton walks back through the steps; the AI takeover note is absent.

---

### TASK-212: Media bubbles in the creator thread and media previews in lists

- `ChatThread.tsx`: a `MediaBubble` for `type: 'MEDIA'` — thumbnail (photo) or poster + duration badge (video) at the board size, optional pesan under it, time, "Manual" tag on my bubbles (as `CrChatSent`). Built here for the creator side; US-037 makes it tappable and uses it on the customer side (same component). Thumbnail `onError` → refetch the latest page once.
- Inbox rows (`CrInbox`) and the customer chat list (`Chats`): when `preview` is null and `last_media_kind` is set, show "Foto" / "Video" (placeholder copy, gap).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/chat/MediaBubble.tsx` (+ spec) | Bubble |
| MODIFY | `apps/miniapp/src/chat/ChatThread.tsx`, `chat.module.css`, `chat-model.ts` | Render MEDIA |
| MODIFY | `apps/miniapp/src/inbox/*`, `apps/miniapp/src/chats/ChatListPage.tsx`, copy files | Previews |

**Testing:** MEDIA with and without pesan; video duration badge; the Manual tag only on the creator side; list/inbox placeholder words; TEXT messages unchanged (existing tests pass).

---

### TASK-213: Visual check and docs

- `pnpm visual` at 390 × 844: `CrAttach`, `CrChatPick`, `CrChatPreview`, `CrChatUpload`, `CrChatSent` (expect differences where Phase F parts are omitted: the AI header chip / panel / takeover note; record the percentage).
- `codebase-map.md` (migration, entities `MessageAttachment`, endpoints changed), `tech-stack.md` decisions (one attachment per message, chat uploads bound to a conversation, unsent-upload cleanup, media preview field), `design-integration.md` Known Gaps (empty picker, list preview words, creator bubble not tappable), `CLAUDE.md`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/` specs | Screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md`, `tech-stack.md`, `design-integration.md`, `CLAUDE.md` | Docs |

**Testing:** full check suite; sheets reviewed.
