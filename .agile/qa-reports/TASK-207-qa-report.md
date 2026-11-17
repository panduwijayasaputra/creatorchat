# QA Report: TASK-207 — Migration — MEDIA messages, attachments, chat-only assets

**Result:** PASS (US-036, 2026-11-18)

## Built
Migrations `20261201010000_chat_media_enums` (MEDIA, CHAT) and `20261201010100_chat_media`: nullable `messages.body` with new CHECKs, `media_assets.conversation_id` with its CHECK, `message_attachments`; Prisma schema and models.

## Verified
Integration tests: a TEXT message without body is refused, a MEDIA message without text is accepted, the 2000-character limit holds for both, an empty text is refused; a CHAT asset needs a conversation and a gallery asset must not have one; a conversation that owns a chat upload cannot be deleted; one attachment per position; the same gallery asset can be attached to many messages with no copy; an attached asset and a message with an attachment cannot be deleted. The table-list baseline test was updated. Full db suite (124) passes.

## Notes
Split in two migrations because a new enum value cannot be used in the transaction that adds it. Not applied to the dev database by this work: run `pnpm exec prisma migrate deploy`.
