# US-042: New message and broadcast notifications

**Status:** ready_for_uat
**Priority:** high
**Feature:** telegram-notifications
**Phase:** E
**Roles:** System, USER, CREATOR
**Brief refs:** §4, §9, §14, §15, §17
**Design refs:** `RequestApproved` (bot message + "Buka Aplikasi" pattern), `Profile` (defaults); message copy not designed — gap

## Description

As a USER or CREATOR who is not looking at the chat, I want a Telegram message from the bot when a new chat message or broadcast arrives, so that I know to open the app, without being spammed or having the content shown by default.

## Acceptance Criteria

- [ ] A committed creator message (manual, broadcast, welcome) notifies the customer; a committed customer message notifies the creator. The bot message names the sender and has a "Buka Aplikasi" button that deep-links to that conversation; after login the target is re-checked (another user's conversation → the normal not-found / role redirect).
- [ ] Message content is hidden by default ("Tampilkan isi pesan" off); shown (shortened) only when the recipient turned it on (US-043). Chat text is never written to logs or the delivery table.
- [ ] Consecutive messages in the same conversation within a short window produce one notification (e.g. "3 pesan baru"), not one per message; no notification while the recipient has the conversation open with fresh presence; none when the customer turned "Notifikasi pesan" off or muted that creator (US-043).
- [ ] Telegram failures: `retry_after` is respected, transient errors retry with backoff and a cap, a "bot was blocked" answer marks the user bot-blocked and stops retrying (US-013 behaviour), an ambiguous timeout is not claimed as delivered twice. The chat message stays saved and visible whatever happens to the notification.
- [ ] Idempotent per message (or coalesced batch) + recipient: a duplicate event or job retry does not send a second notification. Tests use a fake Telegram client; no real bot sends in tests.

## Tasks

### TASK-231: Migration — notification preferences, mutes, state
**Status:** done

### TASK-232: Dispatcher `minAgeMs` and the message notification handler
**Status:** done

### TASK-233: Worker wiring, end-to-end test and docs
**Status:** done
