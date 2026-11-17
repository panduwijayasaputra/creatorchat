# QA Report: TASK-128 - Migration: access_requests and seed (US-022)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
db integration: default PENDING, the partial unique index (a second PENDING is refused, decided rows and other pairs are allowed), the review CHECK in all four directions, the reason length bounds, RESTRICT on customer / creator / admin; seed adds the pending request once and now also Raka's expired subscription to Kirana; the table-scope test lists `access_requests`.

Full runs: contracts 244, db 90, backend-core 403, api 273, miniapp 228, admin 293, worker 29 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
`seed` test expectations for Raka's subscriptions changed from 1 to 2 on purpose.
