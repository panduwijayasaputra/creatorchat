# US-037: Customer receives and opens chat media

**Status:** ready_for_uat
**Priority:** high
**Feature:** chat-media
**Phase:** D
**Roles:** USER
**Brief refs:** §6 (received attachments readable after expiry; not when the account is blocked), §8B, §8E (attachment keeps the read right; signed URLs after check; no object keys), §15 (IDOR), §17 (expiry keeps received attachments)
**Design refs:** `Chat` (photo bubble with text, video bubble with duration), `ChatExpired`, `MediaPhoto`, `MediaVideo`

## Description

As a USER, I want to see photos and videos my creator sent me and open them full screen, also after my access has ended, so that I keep what I received.

## Acceptance Criteria

- [ ] In `/chats/:conversationId` a media message shows as in `Chat`: photo thumbnail or video poster with duration ("0:42"), the pesan text under it when there is one, and the time. The creator side shows the same bubble in its own thread.
- [ ] Tapping the bubble opens the viewer matching `MediaPhoto` / `MediaVideo`: Tutup, "n / N" across the media of this conversation, previous / next, video controls, the pesan text and "{creator} · {waktu}" in my display timezone.
- [ ] With EXPIRED access (or a blocked creator) the attachments I already received still open (`ChatExpired`); the gallery stays locked (US-034).
- [ ] The signed-URL endpoint checks that the attachment belongs to a message in my own conversation: another customer's attachment id, a gallery asset id I was never sent, or a malformed id → the same 404. A blocked account → 401. URLs are short-lived and never include the object key.
- [ ] If the media cannot be loaded, the bubble and viewer show a neutral error with retry instead of a broken image; the exact state is a design gap (Known Gaps: revoked/deleted attachments).

## Tasks

### TASK-214: Contracts and `ChatMediaService`
**Status:** done

### TASK-215: API — customer chat media endpoints
**Status:** done

### TASK-216: Mini App customer media bubbles and viewer
**Status:** done

### TASK-217: Visual check and docs
**Status:** done
