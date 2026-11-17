# US-035: Admin creator Galeri tab and media detail

**Status:** ready_for_uat
**Priority:** medium
**Feature:** creator-gallery
**Phase:** D
**Roles:** Admin
**Brief refs:** §11 (creator detail: gallery table with View media; no private chat or private attachments by default; all-tables rules), §8E
**Design refs:** `AdmCrGallery`, `AdmMediaDetail`, `AdmTableStates`

## Description

As an Admin, I want to see a creator's gallery media in a table and open one item's details, so that I can check what the creator publishes to subscribers.

## Acceptance Criteria

- [ ] `/creators/:id/gallery` replaces the placeholder tab with the `AdmCrGallery` table: note "Hanya media galeri yang tampil di sini. Lampiran chat privat tidak ditampilkan dan tidak bisa dibuka secara massal.", search "Cari media", filters Jenis (Semua / Foto / Video) and Diunggah, Reset Filter, columns Thumbnail, Jenis, Durasi, Ukuran, Diunggah, Aksi (View), sorting, pagination 10/25/50 and "Menampilkan a–b dari N hasil". Filtering, sort and paging run on the server (sort allowlist); table states follow `AdmTableStates`.
- [ ] View opens `/creators/:id/gallery/:mediaId` matching `AdmMediaDetail`: Kembali ke Galeri, "Informasi media" (Jenis, Durasi, Ukuran, Diunggah, Creator, "Tampil di: Galeri, untuk subscriber aktif", ID media) and the note "Tampilan admin hanya untuk media galeri. Lampiran chat privat tidak bisa dibuka dari sini." The preview loads through a short-lived signed URL.
- [ ] Chat-only and broadcast-only assets never appear in the table, and their ids return 404 on the detail route and the admin signed-URL endpoint, even for an admin.
- [ ] Admin auth only: a user session → 401; an unknown creator or a media id of another creator → 404. Returning from the detail keeps filters, sort and page.
- [ ] Read-only: no delete, hide or moderation action (not designed).

## Tasks

### TASK-203: Admin gallery contracts and `AdminCreatorGalleryService`
**Status:** done

### TASK-204: Admin API routes
**Status:** done

### TASK-205: Admin Galeri tab and media detail page
**Status:** done

### TASK-206: Visual check and docs
**Status:** done
