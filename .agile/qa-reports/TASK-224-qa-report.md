# QA Report: TASK-224 — BroadcastService.create

**Result:** PASS (US-038, 2026-11-21)

## Built
`BroadcastService.create` (creator row lock → replay → scoped asset lock → active-subscriber count → optional gallery item → broadcast + outbox `broadcast.created`), `BROADCAST_RATE_LIMIT` (10 per minute, optional `FixedWindowLimiter`), `OutboxEventType.BROADCAST_CREATED`.

## Verified
- `broadcast.service.int.spec.ts` (13 cases, real PostgreSQL): gallery file → no new gallery item or object, reusable; upload with the box unticked stays out of the gallery, ticked gets exactly one item (seq 1); an upload belongs to one broadcast; the box with a gallery file is `invalid` and writes nothing; another creator's file, WELCOME, un-galleried and unknown / malformed ids → `media_not_found`; PENDING → `media_not_ready`; only expired / revoked / blocked customers → `no_active_subscribers` and the upload stays usable; a retry replays even after the subscribers are gone, changed content conflicts; two identical concurrent requests → one broadcast and one event; blocked creator / creator account / customer / unknown user → `not_found`; blank / over-long text and a bad client id → `invalid`; rate limit.
