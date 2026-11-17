# QA Report: TASK-127 - Explore and profile access contracts (US-022)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
packages/contracts: 23 new tests (the four states with exactly their fields, foreign / missing fields refused, strict profile and Explore items with no id / status / media / gallery / subscriber_count, query defaults and allowlists).

Full runs: contracts 244, db 90, backend-core 403, api 273, miniapp 228, admin 293, worker 29 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
Deviation from the plan: the US-005 `CreatorLinkResponseSchema` stays unchanged; a new `CreatorProfileResponseSchema` extends it with `access`, and the by-code tests moved to it.
