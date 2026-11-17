# QA Report: TASK-103 - UserDetailService, UserRequestsService, UserHistoryService (US-018)

**Result: PASS** (2026-11-16, self-review by the dev-team run; no separate QA agent)

## Checks
backend-core integration (real PostgreSQL), 12 tests: detail for no / pending / rejected request, subscription counts (revoked and future excluded) and nearest end, block entry with and without reason, creator id → redirect shape, admin / unknown / malformed → null; request table ordinals fixed under filters, status / q (LIKE-literal) / sort / paging, banner data with the block of an active or future subscription only; **IDOR** (another user, a creator id, unknown ids → null); request detail pending / rejected (reviewer username, log id, never the admin id); approved applications are never rows; history scope (two users, rejected application events under the user).

Full runs: contracts 187, backend-core 345, api 242 (two clean runs), admin 236 passed; ESLint and `tsc --noEmit` clean.

## Notes
`q` on the request table matches the rejection reason and the status words; the summary text (with the Indonesian date) is built in TypeScript.
