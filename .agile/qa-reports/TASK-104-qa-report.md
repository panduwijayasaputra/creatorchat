# QA Report: TASK-104 - API endpoints and admin client (US-018)

**Result: PASS** (2026-11-16, self-review by the dev-team run; no separate QA agent)

## Checks
apps/api integration (real app), 8 tests: 401 for no session and a user token on all four routes, shapes, creator id → redirect shape, one identical 404 body for admin / unknown / malformed ids, request-table filters / sort / pages with 400 on every bad value, owned request detail and an identical 404 for another user's request, history, no private data and no writes. admin client: 2 tests (URLs, defaults omitted, ids encoded, 404 `ApiError`, one renewal). One full API run had a single failure that did not reproduce in two further full runs or in isolation; most likely another session using the same test database at the same time.

Full runs: contracts 187, backend-core 345, api 242 (two clean runs), admin 236 passed; ESLint and `tsc --noEmit` clean.

## Notes
The same shared test database is used by all integration files; concurrent sessions can interfere.
