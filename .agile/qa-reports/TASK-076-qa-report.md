# QA Report: TASK-076

**Verdict:** PASS

## Verified (run)
- Migration `20261121010000_notification_deliveries` applied to the dev and test databases: `OutboxEventStatus` +ENQUEUED/FAILED, `outbox_events.enqueued_at/last_error`, `users.bot_blocked_at`, `notification_deliveries` (UNIQUE dedupe key, RESTRICT FKs, index `(status, claimed_at)`). Defaults hold on pre-existing rows. `packages/db` 78 tests (new `notification-schema.int.spec.ts`: defaults, duplicate key refused, unknown user/event refused; identity-baseline table list updated).
- `buildCreatorResultMessage` (6 cases): approved text verbatim from `RequestApproved`; rejected message holds the reason verbatim, HTML-looking reason stays literal; reason ignored for approvals; `null` for unset/malformed/non-http URLs; button URL always the configured origin.
- Typecheck, lint clean.

## Known differences / notes
- The rejected-request copy is a placeholder (design gap), kept as constants in `bot-copy.ts`.
- Dev-process slip, fixed: the first migration file was written empty (BSD `sed`) and applied; its `_prisma_migrations` row was removed from the dev and test databases (both created for this project) and the real SQL re-applied.
