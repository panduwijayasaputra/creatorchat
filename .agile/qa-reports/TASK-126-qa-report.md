# QA Report: TASK-126 - Berikan Akses with the user picker (placeholder-flagged) (US-021)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
component tests: the picker searches on the server (debounced), confirm needs a user and a reason, one grant call with the picked user id and the creator id, success toast and refetch, empty and failed picker states, a blocked creator disables Berikan Akses and Berikan Ulang. The grant dialog was extended (`picker`) instead of forked; its existing tests pass; a bug where picking reset itself was found and fixed.

Full runs: contracts 221, backend-core 386, api 266, admin 293 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
The picker layout and wording have no board and are flagged as a design gap; not screenshot-compared.
