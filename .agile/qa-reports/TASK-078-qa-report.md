# QA Report: TASK-078

**Verdict:** PASS

## Verified (run)
- `CreatorResultNotifier` integration, 20 cases with a fake sender: one message per decision (approved and rejected, chat id from the user row, reason read from the database, payload never trusted); duplicate job and two concurrent workers send once; a settled delivery meets a re-queued event without resending; 429 then success (`available_at ≈ now + retry_after`, attempts 2), absurd `retry_after` clamped to 1 h; 403 → BOT_BLOCKED + `bot_blocked_at`, no retry, next notification SKIPPED without a send; other 4xx → FAILED; 5xx/ambiguous back off (5 s, 30 s) with `ambiguous_attempts` counted and success later; cap of 10 → FAILED; BLOCKED account and bot-blocked user skipped; decision/status mismatch → FAILED with no send; unconfigured Mini App URL waits without spending an attempt; a thrown sender error containing the bot token leaves no trace in either table; the sender is never called inside an open transaction (`pg_stat_activity`); application, role, status and session version untouched on every failure outcome.

## Known differences / notes
- The "vanished user" path of the plan is unreachable (the delivery and application FKs are RESTRICT), so it has no test.
