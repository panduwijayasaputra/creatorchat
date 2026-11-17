# Technical Plan: US-035 — Admin creator Galeri tab and media detail

## Architecture Overview

Vertical slice: contracts (admin gallery query / rows / detail) → `AdminCreatorGalleryService` (backend-core) + `MediaAccessService` admin path → `GET /v1/admin/creators/:id/gallery[/:assetId]` → admin `/creators/:id/gallery` table and `/creators/:id/gallery/:mediaId` detail.

Brief refs: §11 (creator detail gallery table + View media; no private chats/attachments by default; all-table rules), §8E. Design refs: `AdmCrGallery`, `AdmMediaDetail`, `AdmTableStates`.

Decisions (agreed 2026-11-18): rows are labelled "Media #N" with the permanent per-creator `gallery_items.seq` from US-032; "Cari media" matches that number.

Defaults applied (flag if you disagree):

- **Search**: digits with an optional leading `#` (`12`, `#12`) → exact number match; any other text → no results (there is no other searchable field: media has no title).
- **Filters**: Jenis = Semua / Foto / Video; Diunggah = Semua / 7 / 30 / 90 hari terakhir (placeholder options, same as the other admin date filters, gap). Sort allowlist: `number`, `kind`, `duration`, `size`, `uploaded` (default `uploaded desc`). Page size 10/25/50; state in the URL query like the History tab.
- **Detail preview**: photo → the original (5-min signed URL); video → `<video controls>` with the original and the poster. "ID media" shows `med_` + the first 7 hex characters of the asset id (display only; routes use the full uuid).
- **No audit row for viewing** (audit is for mutations, backend.md); read-only.

## Authorization & Data Rules

- `CsrfGuard` + `AdminJwtGuard` (admin principal only; user tokens → 401).
- Creator by `:id` (uuid); unknown / malformed → 404 `CREATOR_NOT_FOUND`. Blocked creators are viewable (admins investigate them).
- Rows only from `gallery_items` of that creator joined with READY assets. Detail scoped by `(gallery_items.creator_id = :id, asset_id = :assetId)`. A chat-only or broadcast-only asset (no gallery item), or another creator's gallery asset → 404 `MEDIA_NOT_FOUND`, also on the signed-URL path, because the admin URL is issued only from inside this scoped lookup.
- Server-side filtering / sort / paging with the allowlist; never load all rows.
- No private message, attachment or conversation data is joined anywhere.

## Dependencies

- US-032 (assets, `seq`, sizes, durations, thumbnails, `GalleryTile`), US-015 (creator detail page + tabs), US-021 (tab table pattern), shared `DataTable`, `Pagination`, `TableToolbar`.

## Risks

- The admin dashboard is served from its own origin; signed media URLs point at the API (local driver) or R2 → plain `<img>` / `<video>` GETs need no CORS. Check the dev proxy does not interfere.
- A board shows "Menampilkan 1–8 dari 12" with 8 rows (same quirk as US-021) → real ranges per page size.

## Tasks

### TASK-203: Admin gallery contracts and `AdminCreatorGalleryService`

Contracts `packages/contracts/src/admin-media.ts`:

```ts
export const ADMIN_GALLERY_SORT_FIELDS = ['number', 'kind', 'duration', 'size', 'uploaded'] as const;
export const AdminGalleryQuerySchema = z.strictObject({
  q: /* trimmed, max 20 */, kind: z.enum(['all', 'PHOTO', 'VIDEO']).default('all'),
  uploaded: z.enum(['all', '7', '30', '90']).default('all'),
  sort: z.enum(ADMIN_GALLERY_SORT_FIELDS).default('uploaded'), dir: z.enum(['asc', 'desc']).default('desc'),
  page, page_size, // same shapes as HistoryQuerySchema
});
export const AdminGalleryRowSchema = z.strictObject({
  asset_id: z.uuid(), number: z.int().positive(), kind: MediaKindSchema,
  duration_seconds: z.int().nullable(), size_bytes: z.int(), uploaded_at: z.iso.datetime(), thumbnail_url: z.url(),
});
export const AdminGalleryResponseSchema = z.strictObject({ items: z.array(AdminGalleryRowSchema), total: z.int(), page: z.int(), page_size: z.int() });
export const AdminMediaDetailSchema = z.strictObject({
  asset_id: z.uuid(), short_id: z.string(), number: z.int().positive(), kind: MediaKindSchema,
  duration_seconds: z.int().nullable(), size_bytes: z.int(), uploaded_at: z.iso.datetime(),
  creator: z.strictObject({ id: z.uuid(), display_name: z.string() }),
  shown_in: z.literal('GALLERY'), preview: MediaOriginalSchema, poster_url: z.url().nullable(),
});
export const adminCreatorGalleryPath = (creatorId: string) => `/v1/admin/creators/${creatorId}/gallery`;
export const adminCreatorMediaPath = (creatorId: string, assetId: string) => `${adminCreatorGalleryPath(creatorId)}/${assetId}`;
```

Backend-core `packages/backend-core/src/media/admin-creator-gallery.service.ts`: `list(creatorId, query)` (one `$queryRaw` with tagged parameters; sort column from an allowlist map, never interpolated text; `uploaded` = `added_at >= now() - interval`), `detail(creatorId, assetId)`. Thumbnails / preview through `MediaAccessService` after the scoped lookup.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/admin-media.ts` (+ spec) | Schemas, paths |
| MODIFY | `packages/contracts/src/index.ts` | Export |
| CREATE | `packages/backend-core/src/media/admin-creator-gallery.service.ts` (+ `.int.spec.ts`) | Queries |
| MODIFY | `packages/backend-core/src/media/index.ts`, `src/index.ts` | Exports |

**Testing (integration):** search `12` / `#12` / `abc`; kind and date filters; every sort field both directions with a stable tiebreak (`seq`); paging totals; a chat-only READY asset and a PROCESSING asset never listed; detail of another creator's asset → not found; strict query rejects unknown sort.

---

### TASK-204: Admin API routes

`apps/api/src/admin/creators/creators.controller.ts` (existing admin creators controller; provider in its module):

| Method | Path | Guard | Response |
|---|---|---|---|
| GET | `/v1/admin/creators/:id/gallery` | `CsrfGuard, AdminJwtGuard` | 200 `AdminGalleryResponse`; 404 `CREATOR_NOT_FOUND`; 400 bad query |
| GET | `/v1/admin/creators/:id/gallery/:assetId` | same | 200 `AdminMediaDetail`; 404 `CREATOR_NOT_FOUND` / `MEDIA_NOT_FOUND` |

`no-store`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | Routes, provider |
| CREATE | `apps/api/test/admin-creator-gallery.int.spec.ts` | Tests |

**Testing:** user session → 401; no CSRF needed for GET; unknown / malformed creator → 404; chat-only asset id → 404; JSON keys snapshot (no object key, no message/conversation ids).

---

### TASK-205: Admin Galeri tab and media detail page

- `apps/admin/src/creators/detail/gallery/`: `GalleryTab.tsx` (replaces the placeholder tab) matching `AdmCrGallery`: info note "Hanya media galeri yang tampil di sini. Lampiran chat privat tidak ditampilkan dan tidak bisa dibuka secara massal.", `TableToolbar` with search "Cari media", Jenis and Diunggah selects, Reset Filter; `DataTable` columns Thumbnail (small `GalleryTile` ready state or the board's thumbnail cell — copy values from the HTML), Jenis (Foto / Video), Durasi ("–" for photos), Ukuran ("2,4 MB", Indonesian decimal comma, 1 decimal for MB), Diunggah ("12 Nov 2026", WIB), Aksi View; sortable headers; pagination + "Baris per halaman"; `AdmTableStates` states. Query in the URL (`gallery-url.ts`, same pattern as `history-url.ts`).
- `MediaDetailPage.tsx` at `/creators/:id/gallery/:mediaId` matching `AdmMediaDetail`: breadcrumb `Dashboard / Creator / {name} / Galeri / Media #N`, "Kembali ke Galeri" link back with the preserved query, preview area, "Informasi media" kv-list (Jenis, Durasi, Ukuran, Diunggah "12 Nov 2026, 06.41 WIB", Creator, Tampil di "Galeri, untuk subscriber aktif", ID media), note "Tampilan admin hanya untuk media galeri. Lampiran chat privat tidak bisa dibuka dari sini." Not-found / load-failed → the placeholder states used by the other admin detail pages (gap).
- `formatBytes` helper (`apps/admin/src/creators/format.ts`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/creators/detail/gallery/GalleryTab.tsx`, `useCreatorGallery.ts`, `gallery-url.ts`, `MediaDetailPage.tsx`, `gallery.module.css` (+ specs) | Screens |
| MODIFY | `apps/admin/src/creators/detail/CreatorDetailPage.tsx`, `apps/admin/src/app/routes.tsx`, `apps/admin/src/auth/api-client.ts` (+ spec), `apps/admin/src/creators/format.ts`, `copy.ts` | Wiring |
| MODIFY | `apps/admin/test/fake-admin-api.ts` | Fixtures |

**Testing:** filter change resets page to 1 and updates the URL; View → detail → back keeps filters/sort/page; sort header toggles direction; empty / no-results / error + Coba Lagi; sizes and durations formatted as on the board.

---

### TASK-206: Visual check and docs

- `pnpm visual` at 1440: `AdmCrGallery`, `AdmMediaDetail`. Review sheets.
- `codebase-map.md`, `design-integration.md` Known Gaps (Diunggah options, search semantics, detail not-found/error), `CLAUDE.md`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/` specs | Screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `CLAUDE.md` | Docs |

**Testing:** full check suite; sheets reviewed.
