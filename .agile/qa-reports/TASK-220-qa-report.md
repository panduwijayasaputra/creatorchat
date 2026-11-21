# QA Report: TASK-220 — Worker wiring, end-to-end test and docs

**Result:** PASS (US-044, 2026-11-21)

## Built
`apps/worker/src/notifications.ts` builds one `TelegramDeliveryRunner` and a `NotificationRouter([creatorResultHandler, accessActivatedHandler])`; the dispatcher claims `router.handledTypes`, the BullMQ consumer calls `router.process`. Docs: codebase-map, design-integration (US-020 gap note).

## Verified
- `apps/worker/src/pipeline.int.spec.ts` (real PostgreSQL + Redis, fake Telegram): 11 pass, including 3 new cases: an admin grant sends one message with the chat button and settles event and delivery; an event that waited while the worker was down is delivered after start; a permanent failure leaves the subscription active (delivery FAILED).
- `pnpm typecheck`, `pnpm lint` exit 0. Full `pnpm test`: 680 of 681 pass.

## Notes
- The one failure is `media-upload.service.int.spec.ts > cleanup > removes old PENDING and FAILED rows…`. It is **not caused by US-044**: it fails the same way with the changes stashed. The test uses a fixed clock (2026-11-18) against database `created_at` values from the real clock, so it broke once the real date passed that day. Left unchanged; needs its own fix.
- Redis was not running on the dev machine; a throwaway local `redis-server` (no persistence) was started for the tests.
