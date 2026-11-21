# QA Report: TASK-232 — Dispatcher minAgeMs and the message notification handler

**Result:** PASS (US-042, 2026-11-21)

## Built
`OutboxDispatcher` option `minAgeMs` (per event type, one clause per delayed type, none when unset); `messageNotificationHandler` with its skip rules, coalescing through `notification_state` (`afterCreate`), the optional preview, placeholder `BOT_COPY` entries.

## Verified
- `outbox-dispatcher.int.spec.ts` (+2): a delayed type is claimed only when old enough, other types are never delayed; an age for an unhandled type is ignored.
- `message-notification-handler.int.spec.ts` (16 cases): customer told (name only, button to the chat, text in neither the sent text nor the delivery row), creator told (inbox path, never content); a burst of 3 → one "3 pesan baru…", the others SKIPPED `coalesced`, a later message notifies again; read chat SKIPPED `read`, read messages not counted; notifications off → `disabled`, muted → `muted`, and the creator is still told about customer messages; preview shortened to 80 characters, Foto / Video for media-only, the caption when there is one, never in a burst, never for the creator; blocked customer / bot-blocked / blocked creator SKIPPED with no Telegram call; an expired customer is still told; an event older than 10 minutes SKIPPED `stale`; a forged event naming no message fails `message_missing`; a 429 retry still sends although the first attempt already marked the burst as told; duplicate job sends once, 403 flags the bot, the message is untouched.
- Notification suite: 89 passed.

## Addendum (found while closing US-041, fixed 2026-11-21)
- **Race:** jobs for several messages of one conversation that run at the same moment each read "nothing told yet" before the first had committed its marker, so a burst could send two notifications (the worker burst test failed under load). Fixed: \`afterCreate\` now makes the decision atomically (compare-and-set on \`notification_state\`); a losing job throws \`SkipDelivery('coalesced')\`, and \`TelegramDeliveryRunner\` records it as a SKIPPED delivery (the row created in that transaction is rolled back first).
- Tests added: \`delivery-runner.int.spec.ts\` (a \`SkipDelivery\` from \`afterCreate\` → SKIPPED delivery, event DONE, nothing sent) and \`message-notification-handler.int.spec.ts\` (five events processed at the same moment → one "5 pesan baru…" notification and four \`coalesced\` skips).
