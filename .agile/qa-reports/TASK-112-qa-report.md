# QA Report: TASK-112

**Verdict:** PASS

## Verified (run)
- `/users` rows: Active shows a live Block, Blocked a live Unblock (no creator rows exist in this list). 5 new page cases: block from a row → one call with the user id and the trimmed reason, toast "Hendra Wijaya diblokir", list refetched and the row becomes Blocked with Unblock; unblock → "Dimas Aditya kembali Active"; a 409 only refreshes with the info toast and no error; filters, sort and page size stay in the URL across a decision; focus returns to the opener. admin 188 tests.
- Playwright (1440 px): `admin-users-dlg-block` vs `AdmDlgUserBlock` (560×444 size match, 1.6%), `admin-users-dlg-unblock` vs `AdmDlgUserUnblock` (size match, 1.6%), `admin-users-toast-unblock` vs `AdmUsersToastUnblock` (400×48 size match, 1.7%); the block sheet is visually identical apart from the browser's textarea resize handle.
- Whole repo: typecheck, lint, Prettier, build and tests pass (backend-core 234, api 203, admin 188, ui 176, contracts 173, db 78, worker 29).

## Known differences / notes
- The Block / Unblock subscription texts are shown exactly as designed; the contradiction between them is recorded as a design gap, and behaviour is "subscriptions untouched".
- The "{name} diblokir" toast is the wording of the `AdmUserBlockedDone` toast (the board of the detail page); the conflict toast is placeholder wording.
