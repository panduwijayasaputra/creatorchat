# QA Report: TASK-140 — User list: pending access count and filter

**Result:** PASS (US-024, 2026-11-17)

## Built
`pending_access_count` per row (pending requests to ACTIVE creators with ACTIVE accounts) and `access=pending` filter in the single projection.

## Verified
2 new integration cases: counts per user, blocked creator / creator account not counted, decided requests not counted, the filter with `q`, `status` and paging; the column set test updated.

## Notes
- No board exists for the banner, the reject dialog text, the toasts or the `/users` chip and filter: placeholder copy in `copy.ts`, reported as a gap.
- Real Telegram untested; the outbox events have no consumer yet (Phase E).
