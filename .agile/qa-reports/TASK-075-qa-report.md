# QA Report: TASK-075

**Verdict:** PASS (components and preview; not wired to a page)

## Verified (run)
- Admin API client: 7 new cases (GET without CSRF; approve with the CSRF header and no id in the body; reject with `{reason}` only; a 409 keeps `code` and `details`; one session renewal then a retry; the id is URL-encoded so it cannot reach another route; a connection failure is a `NetworkError`).
- `ConfirmDialog` additions (`confirmDisabled`, `pendingLabel` with a spinner, `onConfirm` resolving `false` to stay open, a required-reason message): 7 new cases; the 13 existing ones pass. A pending **Batal** stays inert but keeps its outlined look, as on `AdmDlgApproveLoading`.
- `ApproveRequestDialog` (9 cases) and `RejectRequestDialog` (8 cases) against a fake API: board copy; the "Diperiksa ulang … (15.02 WIB)" line; opening in the cannot-approve state when the pre-check finds a subscription; the confirm button inert while loading and after a failed load, with retry; "Memproses…" with Batal blocked and one call on a double click; a 409 blocked turning into the cannot-approve state with the server's count, creator and date; a 409 already-reviewed reported with the winning status and no error; the ineligible-account message; a generic inline failure that never shows the thrown message and can be retried; reason empty/blank → "Alasan wajib diisi." with nothing sent; the trimmed reason and only the application id are sent; a 301-character reason is refused inline; applicant text rendered as text (an `<img>` name creates no element).
- `/__preview` has a `creator-review` section; the preview test opens the dialogs. `pnpm build` confirms no preview code or fixtures reach `dist`.
- Playwright `admin-dlg-approve`, `-approve-loading`, `-approve-fail`, `-reject`, `-reject-empty` reviewed side by side with the board PNGs (only the dialog card): layout, copy, chips, panels, spinner, pink inert buttons, red field and message all match. The cannot-approve state uses the person-with-slash header icon as on the board. All 54 visual items pass.
- admin 102 tests, ui 176 pass; typecheck, lint, Prettier, build clean.

## Known differences
- The initials disc colour varies by person on the boards (lilac, peach, pink); ours picks from the same three colours by id, so Raka's disc is lilac where the board's is peach.
- The reject field shows the browser's resize handle; the board is a static box.
- `refHeight` (visual harness): the approve boards' reference crop is measured from board HTML with a fallback font when Google Fonts is unreachable (386 px vs the PNG's 428 px), so those two items pin the height.

## Not done here (by plan)
- The dialogs are not reachable from a real page: the `/creators` row buttons, the rejection toast and `AdmCrApproved` are wired by US-014 / US-015 (acceptance bullets added to those stories).
