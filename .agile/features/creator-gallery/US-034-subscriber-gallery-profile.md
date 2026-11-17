# US-034: Subscriber gallery on the creator profile

**Status:** ready_for_uat
**Priority:** high
**Feature:** creator-gallery
**Phase:** D
**Roles:** USER
**Brief refs:** §6 (gallery: full media when active; nothing when not), §8A (no blur, no thumbnails for non-subscribers), §8E, §15 (IDOR), §17 (non-subscriber receives no thumbnails or original URLs)
**Design refs:** `CreatorActive` (Galeri tiles), `CreatorGuest` / `CreatorPending` / `CreatorExpired` (panel only, Resolved Conflict #1), `MediaPhoto` / `MediaVideo` (viewer layout); customer gallery viewer details: gap

## Description

As a USER with active access to a creator, I want to see and open the creator's gallery on their profile, so that I get the content my access includes.

## Acceptance Criteria

- [ ] With ACTIVE access, the Galeri section of `/creators/:publicCode` shows the creator's gallery tiles as in `CreatorActive` (photo thumbnail, video poster with duration), newest first, replacing today's placeholder.
- [ ] Tapping a tile opens the viewer in the `MediaPhoto` / `MediaVideo` layout (Tutup, "n / N", previous / next, video controls). Below the media it shows the creator name and upload date; this text is a placeholder (gap).
- [ ] The gallery endpoint and the signed-URL endpoint check entitlement on every call: a GUEST, PENDING or EXPIRED viewer, a blocked creator, or a CREATOR token gets no items, ids, counts, durations or URLs (403 / 404), and the profile keeps the existing "Galeri tersedia untuk subscriber aktif" panel. Tested by calling the endpoints directly, not only through the UI.
- [ ] When access ends while the viewer is open, the next signed-URL request is refused and the viewer shows a short error instead of the media; already-issued URLs are short-lived (minutes).
- [ ] Media that is only a chat attachment or a broadcast-only upload never appears in the gallery list.

## Tasks

### TASK-199: Customer gallery contracts and `CustomerGalleryService`
**Status:** done

### TASK-200: API — customer gallery endpoints
**Status:** done

### TASK-201: Mini App profile gallery and viewer
**Status:** done

### TASK-202: Visual check and docs
**Status:** done
