# QA Report: TASK-197 — `MediaViewer` and `/gallery/:assetId`

**Result:** PASS (US-033, 2026-11-18)

## Built
Shared `MediaViewer` (photo / video, previous / next, video controls, footer), `GalleryViewer` at `/gallery/:assetId` as a child route over the grid, tiles open it, `useBackButton` + Telegram `BackButton` typing, `getGalleryItem` in the API client and fake.

## Verified
Tests: position label and upload time in the account zone; only next at the first item and only previous at the last; next replaces the route (back leaves the viewer); video play / pause labels, elapsed and total time and `playsInline`; a failing file refetches the link once, then shows an error and retry; not-found and load-failed states; Tutup returns to the grid without a second gallery request; direct open goes to `/gallery`; BackButton shown and hidden. Full Mini App suite (426) and lint pass.

## Notes
Placeholder copy for viewer failures and the "Putar video" label is listed as a design gap. Swipe and pinch-zoom are not built.
