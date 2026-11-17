# QA Report: TASK-097 - Header actions: dialogs, `AdmCrApproved`, row links (US-015)

**Result: PASS** (2026-11-16, self-review by the dev-team run; no separate QA agent)

## Checks
Component tests: approve sends one call with the application id, URL becomes the creator id and the banner shows; reject sends the trimmed reason and returns to the list with the toast; block opens the dialog, sends the reason and the refetched header shows Unblock with the toast. The already-reviewed and conflict branches refetch (covered by the dialogs' own specs).

Full runs: admin 213 passed, backend-core 333 passed, api admin-creators / creator-detail / creator-moderation 22 passed; ESLint and `tsc --noEmit` clean.

## Notes
`AdmCrApproved` / `AdmCrBlockedDone` are shown as the existing toast plus the refetched header; no separate Playwright board comparison for those two. Back from detail to list restoring filters relies on the list's URL state (not re-tested here).
