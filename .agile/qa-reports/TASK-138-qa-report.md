# QA Report: TASK-138 — Migration: event link on access requests

**Result:** PASS (US-024, 2026-11-17)

## Built
Migration `20261125010000_access_request_event_link`: nullable `access_requests.subscription_event_id` (FK RESTRICT, index, CHECK: NULL unless APPROVED). Applied to the dev database with `prisma migrate deploy` (only this migration was pending).

## Verified
db 94 tests pass (4 new): optional on APPROVED and linking, refused on PENDING / REJECTED, must reference a real event, a linked event cannot be deleted.

## Notes
- No board exists for the banner, the reject dialog text, the toasts or the `/users` chip and filter: placeholder copy in `copy.ts`, reported as a gap.
- Real Telegram untested; the outbox events have no consumer yet (Phase E).
