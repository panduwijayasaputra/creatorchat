# QA Report: TASK-121 - Shared entitlement predicate and count refactor (US-021)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
backend-core integration: one dataset (active, expired, revoked, not started, blocked customer, blocked creator): creator list, creator detail, user list and user detail agree; SQL predicate vs `isEntitled` over a grid; the request-row mark and approval block still count a future subscription. All creator / user list, detail and moderation suites stay green.

Full runs: contracts 221, backend-core 386, api 266, admin 293 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
**Behaviour change:** a blocked creator now shows 0 subscribers and a blocked customer is not counted (matches `AdmCrBlocked`). One existing US-015 test expectation was updated on purpose. The block dialogs keep date-and-revocation counting (`ignoreAccountStatus`) because they count around a status change.
