# QA Report: US-017 — Admin user list (TASK-098 … TASK-101)

**Result: PASS** (2026-11-16, self-review by the dev-team run; no separate QA agent)

## Checks run
- `packages/contracts` vitest: 152 passed (19 new for `user-list`).
- `packages/backend-core` `user-list.service.int.spec.ts` (real PostgreSQL): 10 passed.
- `apps/api` `test/admin-users.int.spec.ts` (real app): 6 passed.
- `apps/admin` vitest: 166 passed (13 page tests, 5 client tests added). ESLint clean on all touched files; `tsc --noEmit` clean for admin, api, contracts, backend-core.
- Playwright `admin-users-1440` vs `AdmUsers`: sizes match, 15.4 % pixel diff. Reviewed side by side: layout, copy, columns and chips match. Differences: ~5 px vertical offset of the toolbar and table, the Block / Unblock buttons are disabled (faded) by design, and the fixture total is 23, not 1.262.

## Acceptance criteria
- Columns, copy, chips: met (component test + screenshot).
- USER only; an approved user leaves the list: met (service test runs the real approval).
- Server-side search / filters / sort / paging with allowlists (unknown → 400), totals from the server, Reset Filter, page reset, URL state: met (service, API and component tests).
- View → `/users/:id` (placeholder until US-018); Block / Unblock inert (US-019). States: loading / empty / no results / error + Retry: met.
- Admin only (user token → 401), no chat or private data, endpoint never writes: met (API test).

## Notes / not verified
- Tablet and mobile have no `AdmUsers` boards; the creator-list treatment is reused and logged as a design gap. No screenshot comparison for them.
- The page imports styles, `format.ts`, `RequestTarget` and `useLayoutMode` from `apps/admin/src/creators/` instead of duplicating them.
- Another session was editing `api-client.ts` (US-016) at the same time; one import clash was resolved by removing duplicate lines. Re-run the full admin suite after both stories land.
