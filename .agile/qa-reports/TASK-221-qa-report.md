# QA Report: TASK-221 — Migrations: broadcasts and media purposes

**Result:** PASS (US-038, 2026-11-21)

## Built
`20261202010000_broadcast_enums` (`MediaPurpose` + BROADCAST / WELCOME, `BroadcastStatus`, `BroadcastRecipientStatus`) and `20261202010100_broadcast` (`broadcasts`, `broadcast_recipients`, `messages.broadcast_id` with a partial unique index per conversation), and the Prisma models.

## Verified
- `packages/db/test/broadcast.int.spec.ts` (6 cases): BROADCAST / WELCOME assets accept no conversation; the body is optional and 1..2000; one row per (creator, client_broadcast_id); a recipient is DELIVERED exactly when it has a message; one recipient row per customer and short-code reasons; one message of a broadcast per conversation while ordinary messages are unaffected.
- Existing db media / chat-media / messages specs pass.

## Notes
- The partial unique index cannot be modelled in Prisma; it exists in the SQL only (as the access-request index does).
