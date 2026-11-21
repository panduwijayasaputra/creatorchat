# US-040: Creator sets the welcome message

**Status:** ready_for_uat
**Priority:** medium
**Feature:** welcome-message
**Phase:** E
**Roles:** CREATOR
**Brief refs:** §8B, §8E (validate asset ownership); Resolved Conflict #5
**Design refs:** `CrWelcome`, `CrWelcomePick`, `CrWelcomeGallery`, `CrWelcomeUpload`, `CrSettings`

## Description

As a CREATOR, I want to write a welcome message with an optional photo or video and switch it on or off, so that every new subscriber is greeted in my name without me doing it by hand.

## Acceptance Criteria

- [ ] `/settings/welcome` matches `CrWelcome`: switch "Kirim pesan selamat datang" with "Aktif. Dikirim sekali saat seseorang baru subscribe.", "Isi pesan" textarea, "Media (opsional)" with Pilih Galeri / Upload Baru, the live preview "Tampilan di chat pelanggan (seperti pesan biasa darimu)" and the footnote, and Simpan Pesan. It loads the saved values; the `CrSettings` row shows the saved state.
- [ ] Pilih Galeri (`CrWelcomePick` → `CrWelcomeGallery`) references the same gallery asset with "Memakai media yang sama dari galeri. Tidak ada salinan baru."; Upload Baru (`CrWelcomeUpload`) stores an asset that never enters the gallery ("Media ini hanya tersimpan di pesan selamat datang. Tidak masuk ke galeri."). Hapus Media and Ganti Media work before saving.
- [ ] Simpan Pesan validates (text 1–2000 when switched on; media READY and owned by me) and saves; leaving without saving keeps the old values.
- [ ] Authorization: CREATOR only (USER → 403 `FORBIDDEN_ROLE`, blocked creator → 401); another creator's asset id or a non-READY asset → rejected and nothing saved.
- [ ] Failure: a failed save keeps the entered text and media on screen with an error and lets me retry; saving twice gives the same result.

## Tasks

### TASK-240: Migration — `creator_welcome_messages`
**Status:** done

### TASK-241: Contracts and `WelcomeMessageService`
**Status:** done

### TASK-242: API — welcome message endpoints
**Status:** done

### TASK-243: Mini App `/settings/welcome`
**Status:** done

### TASK-244: Visual check and docs
**Status:** done
