# QA Report: TASK-134 — AccessRequestService and last_review

**Result:** PASS (US-023, 2026-11-17)

## Built
`AccessRequestService.submit` (one transaction, customer row then creator row locked, `accessStateOf` decides the type, `ON CONFLICT … WHERE status='PENDING' DO NOTHING`, audit `access.request.created`, outbox `access_request.created` with ids and enum only); `CreatorAccessService.profile` returns `lastReview`.

## Verified
Integration (real PostgreSQL, injected clock) 11 new cases pass: TRIAL / RENEWAL (expired, revoked), active refusal and the exact `ends_at` boundary, repeat returns the existing row with nothing extra written, three parallel submits give one row and one event, a rejected row is kept and a new PENDING added, a grant racing a submit never leaves a pending row, unknown / malformed / blocked creator and blocked / CREATOR callers write nothing, other customers' rows ignored, `lastReview` never shows pending, reasons or other customers.

## Notes
- Real Telegram untested; no payment, price or checkout anywhere.
- Placeholder copy (no board): failed-request message `Permintaan belum terkirim. Coba lagi.` and the sending label `Mengirim…` (marked in `profile-copy.ts`).
- Known limit: an admin grant from user detail leaves an older PENDING request open (US-024 must close it); the approved card can still show after a later direct grant.
