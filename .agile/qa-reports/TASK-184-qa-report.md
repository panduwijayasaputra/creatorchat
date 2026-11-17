# QA Report: TASK-184 — Mini App socket client and provider

**Result:** PASS (US-031, 2026-11-17)

## Built
`socket.io-client` 4.8.4 factory (WebSocket then polling; token read at every attempt), `RealtimeProvider` with `useRealtimeStatus`, `useRealtimeEvent`, `useReconnect`, `useLiveRefresh`; `api.getAccessToken()` and `api.renewAccessToken()`; a fake socket for specs; routes take an optional `realtime` factory (the real one only in `main.tsx`).

## Verified
miniapp tests pass (8 provider tests, 2 api-client tests): connects for USER and CREATOR with the token read at connect time, never without a factory; status transitions and reconnect only after the first connect; malformed events and extra keys dropped; a server hang-up renews the token and reconnects with doubling backoff; a lost session stops retrying and an offline renewal is retried; a network error while connecting renews nothing; unmount closes the socket.

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
