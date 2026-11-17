# QA Report: TASK-168 — `messages.origin` migration and seed check

**Result:** PASS (US-029, 2026-11-17)

## Built
Enum `MessageOrigin` (MANUAL, AI) and `messages.origin NOT NULL DEFAULT 'MANUAL'` in `20261128010000_message_origin`; the seed needed no change.

## Verified
db 106 tests pass: the default is MANUAL, an unknown value is refused; the customer send stores MANUAL (backend-core spec). Applied to the test DB by the test setup; the dev DB needs `prisma migrate deploy` (not run, per safety rules).

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
