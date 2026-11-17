# Feature: chat-media

**Phase:** D — Media
**Roles:** CREATOR, USER, System
**Brief refs:** §6 (received attachments stay readable after expiry, unless the account is blocked), §7 (creator sends text, photo, video; customer sends text only), §8B (Pilih Galeri = same file; Upload Baru = only in that conversation, never in the gallery), §8E (attachment is its own relation; it keeps the receiver's read right; validate asset ownership before attach), §13 (`MessageAttachment`), §15, §17
**Design refs:** `CrAttach`, `CrChatPick`, `CrChatPreview`, `CrChatUpload`, `CrChatSent`, `Chat` (photo and video bubbles), `ChatExpired`, `MediaPhoto`, `MediaVideo`, `CrMain` (storage notes)

## Overview

A creator attaches one photo or video to a chat message, either picked from the gallery (a new attachment row pointing to the same `MediaAsset`, no copy, no new gallery item) or uploaded new (an asset that is only attached to this message and never added to the gallery). The message may carry text ("pesan"). The customer sees media bubbles and opens them in the viewer; attachments they received stay viewable after their access ends. Reuses the upload pipeline and signed-URL rules of `creator-gallery` and the message write path of `manual-chat` (HTTP, `client_message_id`, outbox).

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-036 | Creator sends a photo or video in chat | high |
| US-037 | Customer receives and opens chat media | high |

## Depends on

- US-032 (upload pipeline, verification, thumbnail/poster), US-033 (viewer component).
- US-026 / US-029 (message send, idempotency, entitlement re-check), US-031 (realtime `message.created`).

## Decisions to confirm with the Tech Lead

- One media item per message (`CrChatPick`: "Pilih satu foto atau video dari galeri.").
- The note "Mengirim akan mengambil alih percakapan dari AI." on `CrChatPreview` / `CrChatUpload` and the Manual / AI panel on `CrChatSent` are Phase F; not shown until AI exists.
- Customers still send text only (brief §7).

## Design gaps

- Chat list and inbox preview text for a message that is media only (e.g. "Foto" / "Video") is not designed.
- Viewer state for an attachment that is no longer available (brief: revoked/deleted attachments) is not designed (Known Gaps).
