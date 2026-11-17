# QA Report: TASK-161 — Chat list contracts

**Result:** PASS (US-027, 2026-11-17)

## Built
`ChatListQuerySchema` (strict, limit 10/20/50, cursor), `ChatListItemSchema`, `ChatListResponseSchema`, `ChatUnreadResponseSchema`, paths and constants, and a required `conversation_id` (uuid or null) on the profile and Langganan answers.

## Verified
contracts 295 tests pass (new cases): limit allowlist and repeated / unknown keys refused, exact rows with and without a last message, leaked keys (`creator_id`, `customer_id`, `status`, `message_id`, `media`, `body`) refused, 120-character preview cap, https avatar, non-negative counts, `conversation_id` required-nullable on both older contracts.

## Notes
- Opening a chat does not clear the badge: the read cursor writer is US-030. Realtime is US-031, so counts are as fresh as the last navigation.
- Placeholder copy (no board): Muat lagi and its failure text, "Belum ada pesan", the blocked-creator row chip.
- Real Telegram untested.
