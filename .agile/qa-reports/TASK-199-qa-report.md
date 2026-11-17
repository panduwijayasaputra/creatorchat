# QA Report: TASK-199 — Customer gallery contracts and `CustomerGalleryService`

**Result:** PASS (US-034, 2026-11-18)

## Built
Customer gallery contracts (`PublicMediaItem`, list, detail, paths), error code `GALLERY_ACCESS_REQUIRED`, shared `gallery-queries.ts` (the creator side now uses it too), subscriber link paths in `MediaAccessService` and `CustomerGalleryService`.

## Verified
13 integration tests: an active subscriber gets newest-first items, totals, cursor paging, detail with position / neighbours / creator name and a 5-minute link; guest, expired, revoked, future-start, pending-request-only, other-creator subscription and a blocked customer are all not_entitled for the list and every item id; blocked creator, blocked creator account and malformed codes are creator_not_found; another creator's, READY-but-not-gallery, PROCESSING and malformed asset ids are media_not_found; access ending between two calls turns the second into not_entitled. The 40 earlier media tests still pass after the refactor.

## Notes
Entitlement is evaluated before any media lookup and again inside the signers. Items without a signed thumbnail (access just ended) are dropped rather than shown bare.
