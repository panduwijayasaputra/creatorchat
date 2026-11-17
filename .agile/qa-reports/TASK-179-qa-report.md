# QA Report: TASK-179 — Realtime contracts

**Result:** PASS (US-031, 2026-11-17)

## Built
`realtime.ts`: `REALTIME_PATH`, `userRoom`, strict signal schemas (`message.created {conversation_id, seq}`, `read.updated {conversation_id, through_seq}`, `conversation.updated`, `session.ended`), the handshake `auth` schema and connect-error codes.

## Verified
contracts 314 tests pass (3 new): exact shapes accepted; `body` / `preview` / `customer_id` keys, a non-uuid id and `seq: 0` refused; stable room name; token required in the handshake.

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
