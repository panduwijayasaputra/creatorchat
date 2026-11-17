# QA Report: TASK-120 - Subscription detail, events and subscribers contracts (US-021)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
packages/contracts: 22 new tests (defaults, allowlists, strict schemas with no reason / admin id / changes / role, https avatar, the 20-item picker cap, `daysBetweenJakarta` at the Jakarta midnight boundary).

Full runs: contracts 221, backend-core 386, api 266, admin 293 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
None.
