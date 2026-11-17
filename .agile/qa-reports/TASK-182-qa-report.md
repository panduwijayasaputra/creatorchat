# QA Report: TASK-182 — Worker wiring

**Result:** PASS (US-031, 2026-11-17)

## Built
`startRealtime` (ioredis + `@socket.io/redis-emitter`) runs `publishPending` every second through the existing non-reentrant loop helper, independent of the Telegram configuration; started and stopped in `main.ts`.

## Verified
worker 31 tests pass (2 new, real Redis and a socket.io server with the Redis adapter): a committed message reaches the participants' rooms and not a stranger's, and the outbox row is stamped; a failing tick does not stop the loop and `stop()` resolves. Packages pinned: `@socket.io/redis-emitter` 5.1.0 (plus `socket.io` / adapter / client 4.8.4 / 8.3.0 as test devDependencies).

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
