# QA Report: TASK-135 — API endpoint and Mini App client

**Result:** PASS (US-023, 2026-11-17)

## Built
`POST /v1/creators/by-code/:publicCode/access-requests` (201 created / 200 existing, 404, 409 `ACCESS_ALREADY_ACTIVE`, 401 for a no-longer-eligible account), `last_review` on the by-code answer, `requestAccess` in the Mini App client and the fake API.

## Verified
`apps/api` integration 5 new cases pass (also the US-022 / US-005 suites): USER 201 then 200 with the same body; type derived and body (`user_id`, `type`, `creator_id`, `status`) ignored; 409 writes nothing; IDOR (two customers, separate rows); identical 404 for unknown / malformed / blocked creator and blocked creator account; CREATOR 403 `FORBIDDEN_ROLE`, no token and blocked customer 401; no ids, reason or admin in any body. Miniapp client 2 new cases (URL, no body, Bearer, 409 / 404, extra fields refused).

## Notes
- Real Telegram untested; no payment, price or checkout anywhere.
- Placeholder copy (no board): failed-request message `Permintaan belum terkirim. Coba lagi.` and the sending label `Mengirim…` (marked in `profile-copy.ts`).
- Known limit: an admin grant from user detail leaves an older PENDING request open (US-024 must close it); the approved card can still show after a later direct grant.
