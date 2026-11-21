# QA Report: TASK-233 — Worker wiring, end-to-end tests and docs

**Result:** PASS (US-042, 2026-11-21)

## Built
Router gets the handler; the dispatcher holds `message.created` for `MESSAGE_NOTIFY_DELAY_MS` (30 s, `messageDelayMs` for tests). Docs: codebase-map, design-integration (placeholder wording, creator settings, presence substitute).

## Verified
- `apps/worker/src/pipeline.int.spec.ts` (+4, real PostgreSQL + Redis, fake Telegram, real `CreatorChatService.send`): nothing is sent inside the delay, then exactly one notification, the event is DONE and `realtime_published_at` is untouched; a chat read during the delay is SKIPPED `read`; three messages → one "3 pesan baru…" with three deliveries; a permanently failed notification leaves the message as it was. The message text never appears in the logs. 15 pipeline tests pass.
