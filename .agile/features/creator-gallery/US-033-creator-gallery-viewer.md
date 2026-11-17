# US-033: Creator gallery viewer

**Status:** ready_for_uat
**Priority:** medium
**Feature:** creator-gallery
**Phase:** D
**Roles:** CREATOR
**Brief refs:** §8A, §8E (signed URL after access check), §10 (media viewer)
**Design refs:** `CrViewerPhoto`, `CrViewerVideo`

## Description

As a CREATOR, I want to open a gallery item full screen and move between items, so that I can check what my subscribers see.

## Acceptance Criteria

- [ ] Tapping a tile on `/gallery` opens the viewer matching `CrViewerPhoto` / `CrViewerVideo`: Tutup, position "1 / 12", previous / next ("Media sebelumnya" / "Media berikutnya"), and "Diunggah 12 Nov 2026, 06.41 WIB" in my display timezone.
- [ ] Videos play inline with the board's controls (pause, elapsed "0:18" / total "0:48"); photos show the full-size image.
- [ ] The original file is loaded through a short-lived signed URL issued only after checking that I own the asset; an expired URL is refreshed by asking the API again, not by reusing a stored URL.
- [ ] Another creator's media id → 404, a USER token → 403. Telegram Back and Tutup return to the gallery at the same scroll position.
- [ ] No delete, edit or share action (not designed).

## Tasks

### TASK-196: Creator gallery item detail endpoint
**Status:** done

### TASK-197: `MediaViewer` and `/gallery/:assetId`
**Status:** done

### TASK-198: Visual check and docs
**Status:** done
