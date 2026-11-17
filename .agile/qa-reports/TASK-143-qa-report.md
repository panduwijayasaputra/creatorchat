# QA Report: TASK-143 — Langganan contracts

**Result:** PASS (US-025, 2026-11-17)

## Built
`SUBSCRIPTIONS_PATH`, `SUBSCRIPTIONS_MAX = 100`, `SubscriptionItemSchema` (strict, no GUEST, `creator_available`) and `SubscriptionsResponseSchema`.

## Verified
contracts tests pass (new cases): each of the three states accepted with exactly its fields; GUEST, foreign state fields, missing `creator_available`, leaked keys (`id`, `creator_id`, `status`, `media`, `gallery`, `subscriber_count`, `review_reason`) and a non-https avatar refused; 101 items refused.

## Notes
- Placeholder copy (no board): empty / error / loading text, the blocked-creator note, the sending label and failure message of the extend button.
- Real Telegram untested. `pnpm test` in `packages/db` currently fails one scope test because another session added a `messages` table (migration `20261126010000_messages`); that is not part of this story.
