# QA Report: TASK-111

**Verdict:** PASS

## Verified (run)
- Client (4 cases): GET pre-check without CSRF; block / unblock POSTs carry the CSRF header with the reason as the only body field; a 409 keeps `code` and `details`; the id is URL-encoded so it cannot build another route.
- Dialogs (11 cases): `BlockUserDialog` shows the board (identity, "(1)" in bold, the designed consequence text, required reason, audit hint, Active chip); the second sentence is left out with no subscription; the button is inert until the pre-check is in; empty reason → "Alasan wajib diisi." and no call; one call with the trimmed reason even on a double click; a failure keeps the dialog and the typed reason and never shows the thrown message; status and role conflicts become a `conflict` decision; pre-check failure → retry loads again; a hostile name renders as text. `UnblockUserDialog`: board text, required reason, one call with the trimmed reason, conflict, generic failure.
- Not done: the two dialogs are not added to `/__preview` (as planned); they are exercised through the real list page by the screenshots, as US-016 did.
