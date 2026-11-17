# QA Report: TASK-180 — Schema and migration for the delivery marker

**Result:** PASS (US-031, 2026-11-17)

## Built
`outbox_events.realtime_published_at` (NULL = still to emit) with a partial index for pending message / read rows, in `20261129010000_outbox_realtime`; the migration stamps existing message / read rows so nothing old is emitted.

## Verified
db 109 tests pass (3 new): NULL for new rows; the backfill SQL (executed from the migration file) stamps message and read rows only; the partial index exists. Applied to the test DB by the test setup; the dev DB needs `prisma migrate deploy` (not run).

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
