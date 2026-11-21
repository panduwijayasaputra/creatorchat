# QA Report: TASK-222 — Contracts: broadcast and upload purposes

**Result:** PASS (US-038, 2026-11-21)

## Built
`CreateBroadcastBodySchema` (strict; media required, text trimmed 1..2000, `save_to_gallery` default false), `BroadcastSchema`, `creatorBroadcastsPath`; upload purposes BROADCAST / WELCOME (no conversation id); error code `NO_ACTIVE_SUBSCRIBERS`.

## Verified
- `broadcast.spec.ts` and the updated `media.spec.ts`: 370 contract tests pass; missing attachment, blank / over-long text, unknown keys, malformed ids and a conversation id with BROADCAST / WELCOME are refused.
