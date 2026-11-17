# Feature: creator-gallery

**Phase:** D — Media
**Roles:** CREATOR, USER, Admin, System
**Brief refs:** §6 (gallery only for active access), §8A (one gallery, subscribers only, no blur/thumbnails for non-subscribers), §8D (no library/draft/archive/scheduling/analytics; no delete/moderation UI unless designed), §8E (private R2, one `MediaAsset` per upload, gallery membership is a separate relation, signed URLs after access check, real MIME/size check, cleanup of abandoned uploads, technical thumbnail/poster), §11 (creator detail gallery table + View media), §13 (`MediaAsset`, `GalleryItem`), §15, §17
**Design refs:** `CrGallery`, `CrGalleryUploading`, `CrGalleryDone`, `CrStatesGallery`, `CrViewerPhoto`, `CrViewerVideo`, `CreatorActive` (gallery tiles), `MediaPhoto` / `MediaVideo` (viewer pattern), `AdmCrGallery`, `AdmMediaDetail`, `CrMain` (tile states and storage rules), `AdmSetMedia` (upload limits shown: foto 10 MB, video 200 MB)

## Overview

A creator uploads photos and videos into one gallery. Files go straight from the Mini App to a private R2 bucket with a presigned upload; the server then verifies the real file type and size and only then makes the `MediaAsset` final and adds it to the gallery. The worker makes a thumbnail (photos) or poster + duration (videos). Active subscribers see the gallery on the creator's profile and open media in a viewer; everybody else gets the "Galeri tersedia untuk subscriber aktif" panel and no media data at all (Resolved Conflict #1). Admins see gallery media only, never chat attachments.

This feature builds the upload pipeline and the media-read authorization that `chat-media` (US-036, US-037) and the Phase E broadcast and welcome-message stories reuse.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-032 | Creator gallery: upload photos and videos | high |
| US-033 | Creator gallery viewer | medium |
| US-034 | Subscriber gallery on the creator profile | high |
| US-035 | Admin creator Galeri tab and media detail | medium |

## Depends on

- `customer-access` entitlement rule (`accessStateOf` / `isEntitled`) for every gallery read and signed URL.
- US-022 profile states (`CreatorGuest` / `CreatorPending` / `CreatorExpired` panel already built; `CreatorActive` gallery placeholder gets replaced).
- US-015 creator detail tabs (the Galeri tab is a placeholder today).
- US-009 display timezone for "Diunggah …" dates.

## Decisions to confirm with the Tech Lead

- Local development must not write to production R2 (brief §17). Tech Lead picks the local storage path (a dev bucket, or an S3-compatible local fake behind the same adapter) and records it in `tech-stack.md`.
- Upload limits come from config with the `AdmSetMedia` values as defaults (photo 10 MB, video 200 MB). The admin screen to edit them is Phase G.
- One file per Upload tap (the boards show a single uploading tile). Multi-select is not built.
- No delete / hide / reorder of gallery items: not designed (brief §8D). The data model must still never delete a file that a message attachment references.

## Design gaps

- Accepted formats and a maximum video duration are not designed (open input, brief §19).
- Customer gallery viewer: `MediaPhoto` / `MediaVideo` are the chat-attachment viewer (they show the message text and sender + time). The customer gallery viewer reuses that layout without the message text; what it shows below the media is a gap.
- How many tiles `CreatorActive` shows and how more are loaded is not designed.
