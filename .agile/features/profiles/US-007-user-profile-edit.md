# US-007: USER profile page and edit profile

**Status:** ready_for_uat
**Priority:** high
**Feature:** profiles
**Phase:** B
**Roles:** USER
**Brief refs:** §3 (Telegram ID is identity; name/photo are initial values; editing doesn't change Telegram), §5, §10, §15
**Design refs:** `Profile`, `EditProfile`, `EditStates` (menyimpan / validasi / berhasil / gagal, isian dipertahankan). "Kebijakan Privasi" page: not designed — gap

## Description

As a USER, I want to see my profile and change my app photo, display name and short bio, so that creators see me the way I want without changing my Telegram account.

## Acceptance Criteria

- [ ] `/profile` renders `Profile` 1:1: profile card (photo, display name, `@username`, "Dari Telegram, tidak bisa diubah", **Edit Profil**), the "Ingin menjadi creator?" card with **Ajukan Jadi Creator** (opens US-010; its pending/rejected/blocked variants come with US-010/US-011), Notifikasi section (shown as designed, not saved until Phase E), Privasi and Bantuan cards. **Hubungi Admin** opens the bot chat; "Kebijakan Privasi" is a gap placeholder.
- [ ] `/profile/edit` renders `EditProfile`: **Nama tampil** (required, 1–40 characters after trimming, "Awalnya dari nama Telegram. Maksimal 40 karakter."), **Bio singkat (opsional)** (max 160, live counter), read-only **Username Telegram** with lock, and the info note. **Simpan Perubahan** saves through the API and shows the toast "Perubahan disimpan"; validation errors show inline ("Nama tampil wajib diisi.").
- [ ] **Pakai Foto Telegram** resets the app photo to the current Telegram photo. **Ganti Foto** shows a placeholder toast until avatar upload ships in Phase D; nothing is uploaded.
- [ ] Only the caller's own profile can be changed: the endpoint takes no user ID, ignores any `id`, `role`, `telegram_id`, `username` or `status` in the body, and a BLOCKED account or stale session is rejected (US-006 rules). Text is stored and rendered as plain text (no HTML).
- [ ] While saving, the button shows "Menyimpan..." and is disabled; a network/server failure shows the "Perubahan belum tersimpan" banner and keeps what was typed (`EditStates` 4). Saving the same values twice is harmless.
- [ ] Playwright screenshots of `/profile` and `/profile/edit` at 390 px match `Profile` and `EditProfile`; integration tests cover validation limits, field allowlist and blocked/stale session.

## Tasks

### TASK-048: Profile contracts, `telegram_avatar_url` migration, decisions log
**Status:** done

### TASK-049: `ProfileService.updateOwnProfile` in backend-core
**Status:** done

### TASK-050: `PATCH /v1/me/profile` endpoint
**Status:** done

### TASK-051: Mini App API client, profile state, shared Avatar and Switch
**Status:** done

### TASK-052: `/profile` screen (`Profile`)
**Status:** done

### TASK-053: `/profile/edit` screen with `EditStates` and visual check
**Status:** done
