# QA Report: TASK-129 - accessStateOf and CreatorAccessService (US-022)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
backend-core: pure state function (precedence matrix, revoked, boundary ends_at = now / one ms before, agreement with `isEntitled` over a grid) and integration (real PostgreSQL, injected clock): Explore lists only ACTIVE creators by name, the three states of the board, another customer's access never shows, revoked and just-expired are EXPIRED, paging, non-https avatar dropped, only public keys; profile for each state, not found for unknown / malformed / blocked / inactive.

Full runs: contracts 244, db 90, backend-core 403, api 273, miniapp 228, admin 293, worker 29 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
None.
