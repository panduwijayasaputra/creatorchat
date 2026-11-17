# QA Report: TASK-214 — Contracts and `ChatMediaService`

**Result:** PASS (US-037, 2026-11-18)

## Built
Contracts (ChatMediaItem/List/Detail, paths) and ChatMediaService: list/detail scoped to the caller's conversation, position/prev/next via window functions, no subscription check.

## Verified
backend-core 7 integration tests (IDOR, other customer, expired access still readable, pagination); contracts 3 tests.

## Notes
Originals signed through MediaAccessService.originalUrlForParticipant (5 min), thumbnails 15 min.
