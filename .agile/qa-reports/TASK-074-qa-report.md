# QA Report: TASK-074

**Verdict:** PASS

## Verified (run, real HTTP with an admin cookie jar plus Telegram sessions through `inject`)
- 21 integration cases in `creator-requests.int.spec.ts`: GET returns the request, applicant and pre-check (Raka-style subscription details from the server); approve and reject with cookie + CSRF; any body on approve is ignored and extra keys on reject are stripped (a status, role or admin id changes nothing).
- **Same-account conversion end to end:** after approval the applicant's old token answers 401 on `/v1/me` and on user routes, a new Telegram login returns the same user id with role CREATOR, `GET /v1/creator/settings` works for them, and `GET /v1/creators/by-code/<code>` resolves for a customer with the requested name.
- Errors: 404 for unknown and malformed ids on all three routes; 400 with "Alasan wajib diisi." for empty, blank, missing and non-string reasons and for 301 characters; 409 `CREATOR_APPROVAL_BLOCKED` (active and future), `CREATOR_REQUEST_ALREADY_REVIEWED` (with the winning status), `CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE`; a blocked applicant can be rejected but not approved. Nothing changes on any refused call.
- Concurrency over HTTP: two approves (200 + 409) and approve vs reject (one decision, one outbox event).
- Access: no cookie, a garbage cookie and a Telegram user token (Bearer) get 401/403; a missing CSRF header or a foreign origin gets 403 `CSRF_FAILED`; nothing is written. Responses never contain the reviewing admin id, a hash, a token or a secret.
- After a rejection the applicant sees the stored reason and can apply again (a new row; the rejected one is untouched). `roles-declared.spec.ts` still passes. `pnpm --filter @creatorchat/api test` 191 pass.

## Notes
- No Telegram message is sent: events wait in `outbox_events` (PENDING) until US-013 builds the dispatcher and worker.
