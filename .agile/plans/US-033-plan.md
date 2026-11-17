# Technical Plan: US-033 — Creator gallery viewer

## Architecture Overview

Vertical slice: contract (gallery item detail) → `MediaAccessService` owner path for originals → `GET /v1/creator/gallery/:assetId` → shared Mini App `MediaViewer` (reused by US-034 and US-037) → nested route `/gallery/:assetId` over the gallery page.

Brief refs: §8A, §8E (signed URL after an access check; never store URLs), §10 (media viewer). Design refs: `CrViewerPhoto`, `CrViewerVideo`.

Defaults applied (flag if you disagree):

- **One detail call per item**: the server returns the item, a 5-minute original URL, its position ("1 / 12", newest = 1, ordered by `gallery_items.seq`) and the previous / next asset ids. The viewer works on a direct reload too, without the gallery list in memory.
- **Nested route**: `/gallery/:assetId` renders the viewer as an overlay child of `GalleryPage`, so the grid, its loaded pages and scroll position stay mounted; Tutup and the Telegram BackButton navigate back.
- **URL expiry**: the `<img>` / `<video>` `error` event refetches the detail once (a fresh signed URL), then shows a neutral error with retry. URLs live only in component state.
- **Shared viewer** lives in `apps/miniapp/src/media/` (only the Mini App uses it, so not `packages/ui`).

## Authorization & Data Rules

- `UserJwtGuard` + `@Roles('CREATOR')`; asset scoped by `gallery_items.creator_id = <mine>` and asset READY. Unknown, malformed, not READY, not in my gallery (e.g. a US-036 chat-only upload) or another creator's id → the same 404 `MEDIA_NOT_FOUND`.
- Original URL issued by `MediaAccessService.originalUrlForOwner` after that check; `Cache-Control: no-store` on the response.
- Read-only; nothing written.

## Dependencies

- US-032 (assets, gallery items with `seq`, storage port with Range support, `GalleryTile`, `/gallery`).
- US-009 `formatDateTime(value, user.timezone)` for "Diunggah 12 Nov 2026, 06.41 WIB".

## Risks

- Video playback in Telegram WebViews (inline playback, Range) → `<video playsInline preload="metadata">`; dev-storage Range already in US-032; device QA in Phase H.
- Swipe gestures are not shown on the boards → buttons only (prev/next as on the board); swipe is not built.

## Tasks

### TASK-196: Creator gallery item detail endpoint

Contract additions (`packages/contracts/src/media.ts`):

```ts
export const MediaOriginalSchema = z.strictObject({ url: z.url(), expires_at: z.iso.datetime() });
export const CreatorGalleryItemDetailSchema = z.strictObject({
  asset: MediaAssetViewSchema,          // READY
  original: MediaOriginalSchema,
  uploaded_at: z.iso.datetime(),        // gallery_items.added_at
  position: z.int().positive(),         // 1 = newest
  total: z.int().positive(),
  previous_id: z.uuid().nullable(),     // newer item
  next_id: z.uuid().nullable(),         // older item
});
export const creatorGalleryItemPath = (assetId: string) => `/v1/creator/gallery/${assetId}`;
```

Backend-core: `MediaUploadService.galleryItemForOwner(userId, assetId)` (one query: the item by `(creator_id, asset_id)`, `position = count(seq >= item.seq)`, `total`, neighbours by `seq` just above / below); `MediaAccessService.originalUrlForOwner(asset)` (5 min, content type = `mime`).

API: `GET /v1/creator/gallery/:assetId` in `CreatorMediaController`, `@Roles('CREATOR')`, `no-store`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/media.ts` (+ spec) | Detail schema, path |
| MODIFY | `packages/backend-core/src/media/media-upload.service.ts`, `media-access.service.ts` (+ int spec) | Detail + original URL |
| MODIFY | `apps/api/src/modules/media/creator-media.controller.ts` | Route |
| MODIFY | `apps/api/test/creator-media.int.spec.ts` | Tests |

**Testing:** position/neighbours for first, middle and last of 3 items; another creator's asset → 404; a PROCESSING asset → 404; a READY asset that is not a gallery item → 404 (insert one directly); USER token → 403; the signed URL fetches the file through dev storage with the right content type.

---

### TASK-197: `MediaViewer` and `/gallery/:assetId`

- `apps/miniapp/src/media/MediaViewer.tsx` (+ module css), from `CrViewerPhoto` / `CrViewerVideo` (exact values from the HTML): dark full-screen layer, top bar with Tutup ("Tutup" aria-label) and position "n / N", media area (photo `<img>` contain; video `<video playsInline preload="metadata">` with the board's own controls: play/pause "Jeda video", elapsed "0:18" / total "0:48", progress bar), previous / next buttons ("Media sebelumnya" / "Media berikutnya", hidden at the ends), footer slot (`children`) for the caption line.
  Props: `{ kind; src: string | null; positionLabel; onClose; onPrevious?; onNext?; onMediaError; footer?: ReactNode; durationSeconds?: number | null }`.
- `apps/miniapp/src/gallery/GalleryViewer.tsx`: reads `:assetId`, calls `api.galleryItem(id)`, footer "Diunggah {formatDateTime}", prev/next → `navigate(/gallery/<id>, { replace: true })`, close → `navigate(-1)` (or `/gallery` when there is no history), Telegram BackButton shown while open. Load-failed / not-found → neutral error inside the viewer with retry / Tutup (placeholder copy, gap).
- `GalleryPage`: tiles get `onOpen` → `/gallery/<asset id>`; route becomes `gallery` with child `:assetId` rendered through an `<Outlet />` overlay.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/media/MediaViewer.tsx`, `media-viewer.module.css`, `MediaViewer.spec.tsx` | Shared viewer |
| CREATE | `apps/miniapp/src/gallery/GalleryViewer.tsx`, `GalleryViewer.spec.tsx` | Route screen |
| MODIFY | `apps/miniapp/src/gallery/GalleryPage.tsx`, `apps/miniapp/src/app/routes.tsx` | Open tiles, nested route |
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec) | `galleryItem()` |

**Testing:** position label and buttons at first/last item; next replaces the route; media error → one refetch, then error state; Tutup returns to the grid with the same scroll position (grid not remounted); video controls toggle play/pause and show durations.

---

### TASK-198: Visual check and docs

- `pnpm visual` at 390 × 844: `CrViewerPhoto`, `CrViewerVideo` (fixture images from `visual/fixtures`). Review sheets.
- `codebase-map.md` (route, endpoint, `MediaViewer`), `design-integration.md` Known Gaps (viewer load-failed copy; no swipe), `CLAUDE.md` current state.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/` specs | Board screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `CLAUDE.md` | Docs |

**Testing:** full check suite; sheets reviewed.
