# Technical Plan: US-034 — Subscriber gallery on the creator profile

## Architecture Overview

Vertical slice: contracts (customer gallery list + item detail) → `CustomerGalleryService` (backend-core; entitlement on every call) + `MediaAccessService` subscriber path → `GET /v1/creators/by-code/:publicCode/gallery[/:assetId]` → Mini App: the ACTIVE profile's Galeri section gets real tiles; viewer at `/creators/:publicCode/gallery/:assetId` reusing `MediaViewer` (US-033).

Brief refs: §6 (gallery only with active access), §8A (no blur, no thumbnails for non-subscribers), §8E, §15 (IDOR), §17 ("Non-subscriber receives no gallery thumbnails/original URLs"). Design refs: `CreatorActive` (tiles), `CreatorGuest` / `CreatorPending` / `CreatorExpired` (panel only, Resolved Conflict #1, already built in US-022), `MediaPhoto` / `MediaVideo` (viewer layout).

Defaults applied (flag if you disagree):

- **Separate endpoints, not fields on the profile response.** `GET /v1/creators/by-code/:code` stays media-free for everybody (US-022 tests keep proving it); the gallery has its own endpoints that refuse non-entitled callers. The Mini App calls them only when the profile says ACTIVE.
- **Tiles on the profile**: first page of 30, next pages when the grid end scrolls into view (no "Muat lagi" button; pagination UI is a gap).
- **Viewer footer**: "{creator name} · Diunggah {date}" (placeholder; the board's footer is the chat viewer's "{name} · {time}" + message text).
- **Access ends while browsing**: the next list page, detail or URL refresh answers 403 `GALLERY_ACCESS_REQUIRED`; the Mini App then refetches the profile, which renders the locked panel. Already-issued URLs live ≤ 15 min (thumbnails) / 5 min (originals).

## Authorization & Data Rules

- `UserJwtGuard` + `@Roles('USER')` (CREATOR → 403 `FORBIDDEN_ROLE`).
- Creator by `public_code`; unknown, malformed, BLOCKED creator or BLOCKED creator account → the same 404 `CREATOR_NOT_FOUND` as the profile.
- Entitlement with DB time on **every** call (`isEntitled` from `customer-access`: `starts_at <= now() < ends_at`, not revoked, customer + creator ACTIVE). Not entitled → 403 `GALLERY_ACCESS_REQUIRED` with no other data (no count, no ids).
- Items: only `gallery_items` of that creator joined with READY assets. Chat-only and broadcast-only assets never appear because they have no gallery item.
- Detail: asset scoped by `(gallery_items.creator_id = that creator, asset_id)`; anything else → 404 `MEDIA_NOT_FOUND`. The entitlement check runs before the lookup, so a non-subscriber cannot probe which ids exist.
- Responses never include `state`, `failure`, object keys or the creator's internal id. `no-store`.

## Dependencies

- US-032 (assets, gallery items, `seq` order, storage, `GalleryTile`), US-033 (`MediaViewer`, gallery detail query shape), US-022 (`CreatorAccessService`, profile page), US-020 (`isEntitled`).

## Risks

- A subscriber can save a signed URL and share it for its lifetime → short lifetimes (5/15 min) are the accepted mitigation (brief §8E); no watermarking in MVP.
- Large galleries on slow connections → thumbnails are 480 px WebP, loaded lazily (`loading="lazy"`).

## Tasks

### TASK-199: Customer gallery contracts and `CustomerGalleryService`

Contracts (`packages/contracts/src/media.ts`):

```ts
export const PublicMediaItemSchema = z.strictObject({
  id: z.uuid(), kind: MediaKindSchema, duration_seconds: z.int().nullable(), thumbnail_url: z.url(),
});
export const CustomerGalleryResponseSchema = z.strictObject({ items: z.array(PublicMediaItemSchema), total: z.int(), next_cursor: z.string().nullable() });
export const CustomerGalleryItemDetailSchema = z.strictObject({
  item: PublicMediaItemSchema, original: MediaOriginalSchema, uploaded_at: z.iso.datetime(),
  position: z.int().positive(), total: z.int().positive(), previous_id: z.uuid().nullable(), next_id: z.uuid().nullable(),
});
export const customerGalleryPath = (code: string) => `/v1/creators/by-code/${code}/gallery`;
export const customerGalleryItemPath = (code: string, assetId: string) => `${customerGalleryPath(code)}/${assetId}`;
```

Error code `GALLERY_ACCESS_REQUIRED` (403).

Backend-core `packages/backend-core/src/media/customer-gallery.service.ts`:

```ts
export class CustomerGalleryService {
  constructor(prisma, access: MediaAccessService);
  list(userId: string, publicCode: string, query: CreatorGalleryQuery): Promise<Outcome<{ items; total; nextCursor }>>;
  item(userId: string, publicCode: string, assetId: string): Promise<Outcome<Detail>>;
}
// Outcome = { kind: 'ok', … } | { kind: 'creator_not_found' } | { kind: 'not_entitled' } | { kind: 'media_not_found' }
```

Reuse the gallery query / position code from `MediaUploadService` (extract a shared `galleryQueries(tx, creatorId)` helper rather than copying). `MediaAccessService` gains `thumbnailUrl(asset)` / `originalUrl(asset)` used by the owner and subscriber paths alike, but only ever called after the caller-specific check in the service.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/media.ts`, `errors.ts` (+ specs) | Schemas, code |
| CREATE | `packages/backend-core/src/media/gallery-queries.ts` | Shared list / position queries |
| CREATE | `packages/backend-core/src/media/customer-gallery.service.ts` (+ `.int.spec.ts`) | Service |
| MODIFY | `packages/backend-core/src/media/media-upload.service.ts`, `media-access.service.ts`, `index.ts` | Use helper, exports |

**Testing (integration):**
- ACTIVE subscriber → items newest first, total, detail with position / neighbours, URLs work.
- GUEST, PENDING request only, EXPIRED, revoked, future-start subscription → `not_entitled`, no data.
- Customer BLOCKED → handled by the guard (API test); creator BLOCKED → `creator_not_found`.
- Asset of another creator, a chat-only/non-gallery READY asset, a PROCESSING asset → `media_not_found` for an entitled subscriber.
- Access ends between two calls (update `ends_at`) → second call `not_entitled`.

---

### TASK-200: API — customer gallery endpoints

In `apps/api/src/modules/creators/creators.controller.ts` (same module as the profile; provider `CUSTOMER_GALLERY` in `creators.module.ts`, storage from `MediaModule`'s exported `STORAGE` provider):

| Method | Path | Guard | Response |
|---|---|---|---|
| GET | `/v1/creators/by-code/:publicCode/gallery` | `@Roles('USER')` | 200 `CustomerGalleryResponse`; 403 `GALLERY_ACCESS_REQUIRED`; 404 `CREATOR_NOT_FOUND` |
| GET | `/v1/creators/by-code/:publicCode/gallery/:assetId` | `@Roles('USER')` | 200 `CustomerGalleryItemDetail`; 403; 404 `CREATOR_NOT_FOUND` / `MEDIA_NOT_FOUND` |

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | Routes, provider |
| MODIFY | `apps/api/src/modules/media/media.module.ts` | Export `STORAGE` / `MediaAccessService` |
| CREATE | `apps/api/test/customer-gallery.int.spec.ts` | Tests |

**Testing:** IDOR matrix through HTTP (GUEST / PENDING / EXPIRED / CREATOR token / blocked customer 401 / another creator's asset id / malformed ids); the existing profile endpoint still returns no media fields (assert its JSON keys); response JSON has no `state`, keys or internal ids.

---

### TASK-201: Mini App profile gallery and viewer

- API client: `customerGallery(code, cursor?)`, `customerGalleryItem(code, assetId)`.
- `apps/miniapp/src/creator-link/useCustomerGallery.ts`: enabled only when `access.state === 'ACTIVE'`; pages; 403 → calls the profile's `refresh()` (locked panel takes over).
- `CreatorProfileView.tsx`: the ACTIVE Galeri section renders `GalleryTile` (ready, no "Baru") in the `CreatorActive` grid (values from its HTML), replacing the placeholder; tile `onOpen` → `/creators/:code/gallery/:assetId`; loading (tile skeletons in the grid) / empty (no tiles; placeholder line "Belum ada media di galeri." — gap) / error (retry line — gap).
- `CustomerGalleryViewer.tsx`: nested route under the profile route (overlay, profile stays mounted), `MediaViewer` with footer "{display_name} · Diunggah {date}" (placeholder), prev/next, Telegram BackButton, 403 → close and refresh the profile.
- Route: `creators/:publicCode/gallery/:assetId` as a child of the profile route.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/creator-link/useCustomerGallery.ts`, `CustomerGalleryViewer.tsx` (+ specs) | Data + viewer |
| MODIFY | `apps/miniapp/src/creator-link/CreatorProfileView.tsx`, `profile-copy.ts`, `profile.module.css`, `CreatorLinkPage.tsx` | Tiles, outlet |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `apps/miniapp/src/auth/api-client.ts` (+ spec) | Route, calls |

**Testing:** GUEST / PENDING / EXPIRED render the panel and make **no** gallery request (assert the fake API saw none); ACTIVE renders tiles; 403 mid-session switches to the panel; viewer prev/next and close keep the profile scroll.

---

### TASK-202: Visual check and docs

- `pnpm visual`: `CreatorActive` (full board now that tiles exist; drop the "top part only" crop for this board), `MediaPhoto` / `MediaVideo` layout for the gallery viewer (expect a footer difference: placeholder). Guest / pending / expired boards stay as in US-022.
- `codebase-map.md` (endpoints, route), `design-integration.md` Known Gaps (customer gallery viewer footer, tile paging, empty/error lines), `CLAUDE.md`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/` specs | Screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `CLAUDE.md` | Docs |

**Testing:** full check suite; sheets reviewed.
