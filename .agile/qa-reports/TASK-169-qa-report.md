# QA Report: TASK-169 — `CreatorChatService` in backend-core

**Result:** PASS (US-029, 2026-11-17)

## Built
`history`, `send` and `customerDetail`, scoped by `creators.user_id = me` and an ACTIVE creator account; the send locks the conversation row, replays the same `client_message_id`, requires an entitled customer, writes `last_message_at`, the `MANUAL` message and the id-only outbox event in one transaction.

## Verified
backend-core 541 tests pass (10 new, real PostgreSQL): creator send moves the conversation to the top of the inbox; replay / conflict; 10 concurrent sends with one id give one row, concurrent distinct sends are gap-free; expired, revoked, no subscription, blocked and promoted customers refused with nothing stored (no seq change, no outbox); another creator, a customer id and an unknown id all `not_found`; blocked creator `not_found`; keyset history; username or null; no ids in the output.

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
