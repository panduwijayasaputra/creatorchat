# QA Report: TASK-133 — Access request contracts

**Result:** PASS (US-023, 2026-11-17)

## Built
`SubmitAccessRequestResponseSchema`, `CreatorAccessReviewSchema`, optional `last_review` on the by-code answer, `accessRequestPath`, `ErrorCode.ACCESS_ALREADY_ACTIVE`.

## Verified
`pnpm --filter @creatorchat/contracts test` 247 passed (7 new cases). Strict objects refuse `id`, `creator_id`, `status`, `review_reason`, `reviewed_by`; bad enum values refused; `last_review` optional; path is encoded.

## Notes
- Real Telegram untested; no payment, price or checkout anywhere.
- Placeholder copy (no board): failed-request message `Permintaan belum terkirim. Coba lagi.` and the sending label `Mengirim…` (marked in `profile-copy.ts`).
- Known limit: an admin grant from user detail leaves an older PENDING request open (US-024 must close it); the approved card can still show after a later direct grant.
