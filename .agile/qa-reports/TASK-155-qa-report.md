# QA Report: TASK-155 — Schema, migration and send-path update

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- Migration `20261127010000_inbox` applied to the dev DB with `migrate deploy` (additive, backfill only); `migrate diff`: no difference. No reset.
- `conversation-reads.int.spec.ts` (5): one row per participant, cursor starts at 0, negative refused, RESTRICT on delete, `last_message_at` null on a new conversation, the backfill statement gives the latest message time.
- `ChatService.send` sets `last_message_at` with the message and leaves it alone on a refused send (new test); seed sets it from the last fixture message.
## Findings
- `identity-baseline` table allowlist updated (`conversation_reads`).
