# QA Report: TASK-238 — Reminder / ended handler

**Result:** PASS (US-045, 2026-11-21)

## Built
`accessReminderHandler` for both event types (delivery-time re-checks, `AdmSetNotif` texts, button to Langganan, dedupe per period and kind).

## Verified
- `access-reminder-handler.int.spec.ts` (10 cases, events produced by the real scanner, fake Telegram): the reminder text with the end date in the customer's timezone (WIB and WIT) and a button to `/subscriptions`; skipped after an extension (`extended`), a revoke, a delivery after the end (`already_ended`), a blocked creator, a blocked customer and a customer who blocked the bot, each without a Telegram call; the ended text without a date; an ended notice is skipped when extended again, revoked or not yet ended; a duplicate job sends once, 429 and an ambiguous timeout are retried and counted; a payload end time that is not the subscription's is skipped and a payload without one fails; a permanent failure leaves the subscription untouched.
