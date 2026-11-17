# QA Report: TASK-079

**Verdict:** PASS

## Verified (run)
- grammY sender against a fake Bot API HTTP server (7 cases): plain text, chat id, `web_app` button on the app origin, no `parse_mode`; 429 with `retry_after`; 403; 400; 500; a rejected token (401) is retryable; an unreachable server is ambiguous; no outcome contains the token; an out-of-range chat id is refused before any request.
- Loops (4 cases): ticks on interval, no re-entry of a slow tick, errors logged once by class name and recovery logged, `stop()` waits.
- BullMQ adapter with real Redis and a random test prefix (5 cases): one run per job; same id added twice runs once; the same id is accepted again after completion (retry); a throwing handler is not retried; clean close.
- Pipeline (real PostgreSQL + Redis, fake sender, 8 cases): approval → exactly one message, event DONE, delivery SENT; rejection sends the reason; reconciler recovers a lost job and sends once; 429 then success through the real loops; failed send changes neither approval nor role; a bot-blocked user is skipped, then delivered after the flag is cleared; unconfigured bot or Mini App URL registers nothing and warns once; start/stop clean, token never in logs.
- Bugs found by these tests and fixed: (1) completed BullMQ jobs were kept, so a retry re-adding the same job id was ignored → `removeOnComplete/removeOnFail: true`; (2) the dev PostgreSQL runs in `Asia/Jakarta` and the driver adapter reads/writes UTC wall-clock, so DB `now()` defaults were 7 h off from app dates and due events were never claimed → `createPrismaClient` pins the session to UTC (`options: '-c timezone=UTC'`, new `timezone.int.spec.ts`).
- Full `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` pass.

## Known differences / notes
- Real Telegram is not contacted; sending to a real chat is a manual check with a dev bot.
- Dev rows written before the UTC pin were stored 7 h early on this machine; harmless for dev data.
- `msgpackr-extract` (optional native speed-up of BullMQ) has its build script ignored by pnpm; BullMQ falls back to JavaScript.
