# QA Report: TASK-186 — End-to-end checks, visual and docs

**Result:** PASS (US-031, 2026-11-17)

## Built
Two end-to-end tests through real HTTP, the outbox, the publisher, Redis and real sockets; visual re-run; codebase map, decisions log, gaps and README updated.

## Verified
api e2e (2 tests): customer message → creator and customer get signals without content and the other customer nothing, HTTP shows the text; creator reply and read, customer read reach only the peer; reconnect catch-up returns the two missed messages once and a retried send with the same id stays one row. `pnpm visual` for the inbox, chat list, chat and creator-chat items: all pass, differences unchanged (inbox-offline 7.1%). typecheck, lint, `pnpm build` and all package tests pass.

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
