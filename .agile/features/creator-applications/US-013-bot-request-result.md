# US-013: Bot sends the creator request result

**Status:** backlog
**Priority:** medium
**Feature:** creator-applications
**Phase:** B
**Roles:** System (worker, bot), USER, CREATOR
**Brief refs:** §5 ("bot mengirim hasil"), §9 (notification failure doesn't undo the business change; retry_after/backoff; blocked bot), §13 (`OutboxEvent`, `NotificationDelivery`), §14 (outbox bridges commit → queue; idempotent worker)
**Design refs:** `RequestApproved` (approval message copy). Rejection message: not designed — gap (placeholder)

## Description

As a user who asked to become a creator, I want the bot to tell me the result in Telegram, so that I know without opening the app.

## Acceptance Criteria

- [ ] Approve/reject (US-012) writes an `OutboxEvent` in the same transaction as the decision. A dispatcher enqueues it after commit and a reconciler re-enqueues events left pending (e.g. API crashed after commit). This is the first use of the outbox; Phase E builds on it.
- [ ] The worker sends one bot message per decision. Approved: "Selamat, permintaanmu disetujui. Akunmu sekarang akun creator. Buka aplikasi untuk masuk ke Inbox." with a **Buka Aplikasi** web-app button. Rejected: placeholder copy that includes the admin's reason, plus a button to open the app (gap — final copy not designed).
- [ ] Delivery is idempotent: a dedupe key per decision means a re-run or duplicate job never sends twice when the first send is known to have succeeded. Ambiguous Telegram timeouts are recorded as such, not claimed as exactly-once.
- [ ] Telegram `429 retry_after` is honored with backoff; a user who blocked the bot (403) is marked and not retried forever. A failed notification never rolls back or hides the approval/rejection.
- [ ] Tests use a fake Telegram sender (no real bot calls) and cover: one message per decision, duplicate job, reconciler pick-up after a simulated crash, 429 then success, 403 blocked bot. Logs contain no bot token or message text beyond what's safe.
