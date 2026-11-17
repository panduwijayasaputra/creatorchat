# QA Report: TASK-181 — `RealtimePublisher` in backend-core

**Result:** PASS (US-031, 2026-11-17)

## Built
`publishPending()` claims unpublished `message.created` / `read.updated` rows with `FOR UPDATE SKIP LOCKED`, resolves the two participants from the database, emits through an injected emitter and stamps the rows; events older than 15 minutes, unknown conversations and strangers are stamped without emitting.

## Verified
backend-core 550 tests pass (9 new, real PostgreSQL, recording emitter): a customer message reaches its customer and creator only, as signals with no text; a creator reply likewise; read.updated to the peer and conversation.updated to the reader; a rolled-back message emits nothing and a stamped row never repeats; a failing emit leaves the row and the next tick delivers it, one failing row does not block the others; two racing publishers emit 20 messages × 2 participants exactly once; stale, unknown and stranger rows stamped and skipped; other event types untouched.

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
