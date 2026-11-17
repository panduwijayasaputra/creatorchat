# QA Report: TASK-167 — Creator chat contracts

**Result:** PASS (US-029, 2026-11-17)

## Built
`creator-chat.ts`: strict `CreatorChatMessageSchema` (sender ME/CUSTOMER, origin MANUAL/AI), access (ACTIVE/EXPIRED with `ends_at` / `ended_at`), history, send and customer-detail answers, the two path builders; query and body reuse the customer chat rules.

## Verified
contracts 311 tests pass (4 new): limits and defaults, the customer-side sender, unknown origin and leaked ids (`customer_id`, `telegram_id`) refused, escaped paths.

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
