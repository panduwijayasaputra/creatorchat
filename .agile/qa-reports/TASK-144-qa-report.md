# QA Report: TASK-144 — CreatorAccessService.subscriptions

**Result:** PASS (US-025, 2026-11-17)

## Built
`CreatorAccessService.subscriptions(userId)`: the viewer's subscriptions and pending requests through `accessStateOf`, ordered ACTIVE (soonest end) → PENDING (oldest) → EXPIRED (latest end) then name and code, capped at 100, blocked creators kept with `creatorAvailable: false`.

## Verified
backend-core integration (real PostgreSQL, injected clock), 10 new cases: the three board cards in order; order inside each group and the name / code tie-break; revoked is EXPIRED at its revocation time and a pending renewal beats ended; the expiry boundary is exact; rejected-only and no-relation creators are not listed; blocked creator and blocked account are listed unavailable; another customer's rows never appear; the list agrees with `profile()` for every card; 101 relations give 100 cards with only card fields; empty account gives an empty list.

## Notes
- Placeholder copy (no board): empty / error / loading text, the blocked-creator note, the sending label and failure message of the extend button.
- Real Telegram untested. `pnpm test` in `packages/db` currently fails one scope test because another session added a `messages` table (migration `20261126010000_messages`); that is not part of this story.
