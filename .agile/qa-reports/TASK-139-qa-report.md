# QA Report: TASK-139 — Review service, grant and extend close requests

**Result:** PASS (US-024, 2026-11-17)

## Built
`AccessRequestReviewService` (`listPending`, `reject`), `SubscriptionAccessService.grant` takes `accessRequestId` (lock order customer, creator, request, subscription; `request_reviewed` outcome), grant and extend close the pair's PENDING request as APPROVED with the event id and an `access.request.approved` audit row (`via: request|direct`), outbox `access_request.rejected`, History labels and scope.

## Verified
backend-core 435 tests pass (16 new integration cases on real PostgreSQL): approve links event / admin / time, renewal re-grants from now, direct grant and extend close the request, another pair's / customer's / malformed request id is not_found with nothing written, reviewed request is `request_reviewed`, blocked creator keeps the request pending, reject writes reason in audit but only ids in the outbox, second / parallel rejects act once, grant-vs-reject race over 20 rounds has exactly one winner and no deadlock, History shows the three labels without the reason.

## Notes
- No board exists for the banner, the reject dialog text, the toasts or the `/users` chip and filter: placeholder copy in `copy.ts`, reported as a gap.
- Real Telegram untested; the outbox events have no consumer yet (Phase E).
