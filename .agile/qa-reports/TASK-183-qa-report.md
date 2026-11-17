# QA Report: TASK-183 — Socket.IO gateway in the API

**Result:** PASS (US-031, 2026-11-17)

## Built
`RealtimeService` (module `RealtimeModule`): socket.io 4.8.4 on the Fastify HTTP server at `/realtime` with `@socket.io/redis-adapter` 8.3.0; token only from the handshake `auth`; `authorizeConnection` for USER / CREATOR; joins exactly `user:<own id>`; no client event handlers; Origin allowlist for the WebSocket transport; PostgreSQL `LISTEN account_security` drops a user's sockets on commit of a block, unblock or role change (`AccountSecurityService` now runs `pg_notify`); a 30 s recheck ends stale sessions with `session.ended`.

## Verified
api 368 tests pass (11 new, real app, DB and Redis, real `socket.io-client`): no / garbage / empty token, a token in the URL and a foreign Origin refused (code only); USER and CREATOR accepted; blocked and stale-version tokens refused; a block and a role change disconnect an open socket immediately and the old token cannot return; a rolled-back change disconnects nobody; the recheck sends `session.ended` then disconnects a revoked session and leaves a valid one; two customers of one creator: the message reaches its customer and the creator only, and a client emitting join / subscribe gets nothing; shutdown is clean.

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
