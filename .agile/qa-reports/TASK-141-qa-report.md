# QA Report: TASK-141 — Admin API endpoints and admin client

**Result:** PASS (US-024, 2026-11-17)

## Built
`GET /v1/admin/users/:id/access-requests`, `POST …/access-requests/:requestId/reject`, `access_request_id` on the grant, the `request_reviewed` 409, and `listAccessRequests` / `rejectAccessRequest` in the admin client and fake.

## Verified
apps/api 292 tests pass (13 new): no cookie / user token / missing CSRF refused, exact bodies, empty reason 400 "Alasan wajib diisi.", second reject and reject after approval 409 with the status and no change, IDOR (another customer's request, creator and admin ids, malformed ids) one identical 404, a grant for another pair 404, body admin id and status ignored, customer sees ACTIVE / `last_review` APPROVED or GUEST / REJECTED, outbox without the reason, `access=pending` filter and 400s, History labels. Admin client: URLs, CSRF only on POST, 409 details kept, `access` in the list URL only when not default.

## Notes
- No board exists for the banner, the reject dialog text, the toasts or the `/users` chip and filter: placeholder copy in `copy.ts`, reported as a gap.
- Real Telegram untested; the outbox events have no consumer yet (Phase E).
