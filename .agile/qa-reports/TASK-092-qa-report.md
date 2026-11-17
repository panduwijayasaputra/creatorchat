# QA Report: TASK-092 - `CreatorDetailService` (US-015)

**Result: PASS** (2026-11-16, self-review by the dev-team run; no separate QA agent)

## Checks
backend-core integration (real PostgreSQL): pending request with earlier rejections and subscription block; no block for expired / revoked; creator with subscriber count excluding expired / revoked / future, bio, description, `blocked_at`; approved application id resolves to the creator; rejected, user, unknown and malformed ids are null.

Full runs: admin 213 passed, backend-core 333 passed, api admin-creators / creator-detail / creator-moderation 22 passed; ESLint and `tsc --noEmit` clean.

## Notes
None.
