# US-032: Creator gallery: upload photos and videos

**Status:** ready_for_uat
**Priority:** high
**Feature:** creator-gallery
**Phase:** D
**Roles:** CREATOR, System
**Brief refs:** §8A, §8D, §8E, §13 (`MediaAsset`, `GalleryItem`), §15 (upload rate limit, no public bucket), §17 (upload errors recover without orphan leaks; no production R2 writes in tests)
**Design refs:** `CrGallery`, `CrGalleryUploading`, `CrGalleryDone`, `CrStatesGallery`, `CrMain` (tile states), `AdmSetMedia` (default limits)

## Description

As a CREATOR, I want to upload photos and videos to my gallery, so that my active subscribers can see them.

## Acceptance Criteria

- [ ] `/gallery` matches `CrGallery`: title "Galeri", Upload button, "{n} foto dan video", note "Galeri hanya terlihat oleh subscriber aktif.", a 3-column grid of my items newest first (photo thumbnail; video poster with duration like "0:48"). Empty, loading and failed states match `CrStatesGallery` ("Galeri masih kosong" / "Upload foto atau video. Media galeri hanya terlihat oleh subscriber aktif." / Upload).
- [ ] Upload picks one photo or video, sends it straight to private storage with a short-lived presigned upload, and shows the uploading tile with a percentage (`CrGalleryUploading`). When the server has verified it, the tile shows "Baru", the count goes up and the toast "Media berhasil diunggah ke galeri" appears (`CrGalleryDone`).
- [ ] The server verifies the stored file before it becomes final: real type from the file content (not the extension or client MIME), photo ≤ 10 MB, video ≤ 200 MB (config defaults from `AdmSetMedia`). A file that fails is not added to the gallery, its object is deleted, and the tile shows the `CrStatesGallery` failure ("Unggahan gagal" / "Gagal" / "Coba Lagi"). Uploads still pending after the cleanup window are removed by the worker (no orphan objects or rows).
- [ ] A dropped connection shows "Koneksi terputus saat mengunggah. Media belum masuk ke galeri." with Coba Lagi; retrying the same tile never creates two gallery items (completing an upload twice is idempotent).
- [ ] The worker creates a thumbnail (photo) or poster + duration (video) for each finalized asset. Until it exists the tile shows a neutral placeholder, never the original file URL. Tile images load through short-lived signed URLs issued only to the owning creator.
- [ ] Only a CREATOR can start or complete an upload, and only for their own gallery: a USER token → 403; completing another creator's upload id → 404; a blocked creator → 401. The R2 object key and bucket URL never appear in an API response. No upload UI for deleting, drafts, scheduling or a separate library.

## Tasks

### TASK-187: Storage port, env and local/R2 adapters
**Status:** done

### TASK-188: Media contracts and error codes
**Status:** done

### TASK-189: Migration `media_assets`, `gallery_items`, creator gallery counter
**Status:** done

### TASK-190: `MediaUploadService`, `MediaAccessService`, sniffing (backend-core)
**Status:** done

### TASK-191: API — creator media/gallery endpoints and dev-storage routes
**Status:** done

### TASK-192: Worker — media processing queue and cleanup loop
**Status:** done

### TASK-193: `GalleryTile` shared component
**Status:** done

### TASK-194: Mini App `/gallery` with upload
**Status:** done

### TASK-195: Visual check, docs and decisions log
**Status:** done
