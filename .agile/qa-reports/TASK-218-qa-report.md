# QA Report: TASK-218 — Shared Telegram delivery runner and router

**Result:** PASS (US-044, 2026-11-21)

## Built
`TelegramDeliveryRunner` (claim → send → record, extracted from the US-013 notifier), `NotificationHandler` contract (`resolve` → send / skip / fail, `existingDelivery` in the context, `afterCreate` in the delivery-insert transaction), `NotificationRouter` (type → handler, one dispatcher for all kinds), `buildBotMessage` (button on the configured origin plus a validated path). `CreatorResultNotifier` keeps its public `process(eventId)` and now runs through the router with `creatorResultHandler`.

## Verified
- Existing `creator-result-notifier.int.spec.ts`, `outbox-dispatcher.int.spec.ts`, `backoff.spec.ts`, `creator-result-message.spec.ts` pass unchanged.
- New `delivery-runner.int.spec.ts` (12 cases): send once and settle; 429 waits `retry_after` and the retry sees its own delivery; ambiguous timeout counted; 403 flags the bot; permanent 4xx fails; blocked account / bot skipped without a Telegram call; no message (URL unset) waits without spending an attempt; handler skip recorded as SKIPPED; handler fail closes the event with a safe code; `afterCreate` runs once and rolls back with the insert; unknown event / unhandled type → `missing`; two handlers for one type refused.
- New `message-builder.spec.ts`: `//evil`, `..`, query, fragment, relative, absolute and over-long paths refused; the origin is always the configured one.

## Notes
- The type alias is `DeliveryTx` (a bare `Tx` clashes with the account-security export).
