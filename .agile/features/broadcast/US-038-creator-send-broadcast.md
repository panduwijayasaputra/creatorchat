# US-038: Creator composes and sends a broadcast

**Status:** ready_for_uat
**Priority:** high
**Feature:** broadcast
**Phase:** E
**Roles:** CREATOR
**Brief refs:** §8C, §8D, §8E (validate asset ownership before use), §9 (confirm before dispatch, short result), §15 (rate limits)
**Design refs:** `CrBroadcast`, `CrBroadcastPick`, `CrBroadcastReady`, `CrBroadcastUpload`, `CrBroadcastUploadSaved`, `CrBroadcastConfirm`, `CrBroadcastDone`

## Description

As a CREATOR, I want to send one photo or video with an optional message to all my active subscribers at once, so that every subscriber gets it in their private chat without me sending it one by one.

## Acceptance Criteria

- [ ] `/broadcast` matches `CrBroadcast`: the "Semua Subscriber Aktif" card ("Target selalu seluruh subscriber aktif."), Pilih Galeri / Upload Baru, and Kirim Broadcast disabled until a media item is chosen. There is no target, schedule or draft control.
- [ ] Pilih Galeri opens `CrBroadcastPick` (one item, "1 media dipilih", Lanjut) and leads to `CrBroadcastReady`: preview, Ganti Media, the text field "Tulis pesan broadcast" and the note "Memakai media yang sama dari galeri. Tidak ada salinan baru."; no save-to-gallery checkbox. The broadcast references the same `MediaAsset`; no new object, no new gallery item.
- [ ] Upload Baru leads to `CrBroadcastUpload` with "Simpan juga ke galeri" **unchecked** by default and its note; checking it shows `CrBroadcastUploadSaved`. Checked: after sending, the one uploaded asset is also in my gallery (one gallery item). Unchecked: it is in no gallery and only appears in recipients' broadcast messages.
- [ ] Kirim Broadcast opens `CrBroadcastConfirm` ("Kirim media ini ke seluruh subscriber aktif?", Kirim Broadcast / Batal). Batal sends nothing. Confirming creates one broadcast record and returns quickly (delivery is US-039); the page returns to the empty composer with the toast "Broadcast terkirim ke semua subscriber aktif" (`CrBroadcastDone`) and keeps nothing as a draft.
- [ ] Authorization: only a CREATOR (USER → 403 `FORBIDDEN_ROLE`); a blocked creator → 401; a gallery asset of another creator, an asset that is not READY, or another creator's upload id → the same 404 / 422 and nothing is created. Sending is rate-limited.
- [ ] Retry: the request carries a client id; a repeated confirm (double tap, network retry) creates one broadcast, and a failed request keeps the chosen media and text on screen so the creator can try again.

## Tasks

### TASK-221: Migration — broadcasts and media purposes
**Status:** done

### TASK-222: Contracts — broadcast and upload purposes
**Status:** done

### TASK-223: Backend-core — gallery helper, upload purposes, orphan cleanup
**Status:** done

### TASK-224: Backend-core — `BroadcastService.create`
**Status:** done

### TASK-225: API — `POST /v1/creator/broadcasts` and upload purposes
**Status:** done

### TASK-226: Mini App `/broadcast` composer
**Status:** done

### TASK-227: Visual check and docs
**Status:** done
