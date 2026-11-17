# QA Report: TASK-085

**Verdict:** PASS

## Verified (run)
- 7 more component cases: approve from a row → one call with the row id, dialog closes, list fetched again and the row becomes Active with no Setujui; reject → trimmed reason + only the id, the board toast "Permintaan Luna Aurora ditolak dan dicatat", refetch; a 409 already-reviewed → refresh only, no toast and no error; a 409 blocked approval stays in the dialog ("Tidak bisa disetujui") and does not reload; a double click sends one approval; filters/sort/page size stay in the URL and the query across a decision; focus returns to the opener after Batal.
- Playwright `admin-list-dlg-approve` (dialog opened from the real page vs `AdmDlgApprove`, size match, 2.8%) and `admin-list-toast-rejected` (vs `AdmCreatorsToastRej`, 400×48 size match, 2.3%). The other dialog states are covered by the US-012 preview items (same components).
- Whole repo: typecheck, lint, build and tests pass (admin 138, ui 176, backend-core 275, api 203, contracts 127, db 78, worker 29, miniapp).

## Known differences / notes
- Approval shows no toast (none is designed); the row simply becomes Active after the refetch.
