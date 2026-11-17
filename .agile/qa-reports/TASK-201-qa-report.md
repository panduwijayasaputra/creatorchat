# QA Report: TASK-201 — Mini App profile gallery and viewer

**Result:** PASS (US-034, 2026-11-18)

## Built
`ItemViewer` (generic viewer screen; the creator's `GalleryViewer` is now a thin adapter), `useCustomerGallery`, `ProfileGallery`, `CustomerGalleryViewer`, nested route `/creators/:publicCode/gallery/:assetId`, API client and fake methods, `GalleryTile` portrait (4:5) aspect.

## Verified
Tests: ACTIVE shows tiles with the video length and asks for the gallery once; GUEST / PENDING / EXPIRED show the locked panel and make no gallery request; empty and failed lines (retry works); a 403 from the list or from the item refetches the profile and the locked panel takes over, closing the viewer; the viewer opens over the profile with "{creator} · Diunggah {date}", moves on, and Tutup returns without a second request; direct open works. All 435 Mini App tests, lint and typecheck pass; the 27 earlier viewer tests pass after the refactor.

## Notes
Copy for the profile gallery's empty / failed lines is placeholder (design gap).
