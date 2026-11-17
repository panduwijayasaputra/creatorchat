# QA Report: TASK-124 - Subscription detail page and View wiring (US-021)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
admin component tests (13): board copy for Active / expired / revoked, Perpanjang / Cabut only when Active and Berikan Ulang otherwise, extend / revoke call the US-020 API with this subscription and refetch with the toast, a 409 shows the conflict toast, events sort / paging in the URL, View → log with a back state and disabled without a log id, events-only error with retry, back link from router state and fallback, 404 and generic error, text as text; the Langganan tab View now opens the page. Playwright: AdmSubDetail 3.81 % diff, size matches.

Full runs: contracts 221, backend-core 386, api 266, admin 293 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
**Mistake and repair:** while adding fixtures I overwrote `apps/admin/test/subscription-fixtures.ts`, which US-020's visual spec imports (`SALSA_ACCESS`, `KIRANA_ACCESS`, `ACCESS_ROWS`, `accessAction`). The file was untracked, so I rebuilt those exports from their usages and re-ran the US-020 boards: AdmUserSubs 3.96 %, AdmDlgGrant 1.59 %, the three toasts 2.7–3.1 %, sizes matching. I could not compare against the earlier diff numbers.
