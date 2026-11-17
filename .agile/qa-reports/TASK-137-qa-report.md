# QA Report: TASK-137 — Access request review contracts

**Result:** PASS (US-024, 2026-11-17)

## Built
`access-request-review.ts` (banner list, reject body / response, paths), `access_request_id` on the grant body, `ErrorCode.ACCESS_REQUEST_ALREADY_REVIEWED`, user-list `access` query and `pending_access_count` row.

## Verified
contracts 253 tests pass (6 new cases): reason rules (empty, blank, 301 code points, control characters, emoji by code point, other keys stripped), strict objects refuse leaked keys, `access=all` / repeated / empty refused, the old grant body still parses.

## Notes
- No board exists for the banner, the reject dialog text, the toasts or the `/users` chip and filter: placeholder copy in `copy.ts`, reported as a gap.
- Real Telegram untested; the outbox events have no consumer yet (Phase E).
