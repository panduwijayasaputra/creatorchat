# QA Report: TASK-208 — Contracts — attachments, media send, previews

**Result:** PASS (US-036, 2026-11-18)

## Built
Contracts: `ChatAttachmentSchema`, message shape with `type` / nullable `body` / `attachments` on both sides (with a consistency check), `CreatorSendMessageBodySchema` (text, file or both), upload `purpose` / `conversation_id`, `media_kind` on list rows and `preview_media_kind` on inbox rows, `MEDIA_NOT_READY`.

## Verified
Contract tests (360): text, media with and without text; a TEXT message with an attachment or without a body, a MEDIA message without an attachment, attachments with storage keys or without thumbnails are all rejected; the customer send body still rejects `attachment`; creator send needs text or file and rejects empty / too long text, bad asset ids and extra keys; CHAT needs a conversation and GALLERY must not have one.

## Notes
List previews stay strings (empty for media-only) with a separate media kind, so existing text fixtures changed minimally.
