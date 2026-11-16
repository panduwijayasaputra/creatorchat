# US-008: Creator settings, edit profile and bio link

**Status:** ready_for_uat
**Priority:** high
**Feature:** profiles
**Phase:** B
**Roles:** CREATOR
**Brief refs:** §3 (creator is the same account), §4 (link pattern `t.me/<bot>?start=c_<public_code>`), §5, §10 (creator profile, bot link for bio)
**Design refs:** `CrSettings`, `CrEditProfile`, `EditStates` (same states). Category/city in "Preview profil": not designed as an input — gap

## Description

As a CREATOR, I want a settings page where I can edit my public profile and copy my bot link for my Instagram bio, so that my followers land on my profile in the app.

## Acceptance Criteria

- [ ] `/settings` renders `CrSettings` 1:1: header (photo, name, `@username · dari Telegram`, chip "Creator · disetujui admin"), "Preview profil" card, **Edit Profil**, "Link bot untuk bio Instagram" with **Salin Link Profil**, the persona/sambutan/harga/zona waktu list, and "Akun dan bantuan". Rows for later phases (Persona AI, Pesan selamat datang, Harga subscription) open the "belum dibangun" placeholder and show no fake status chips.
- [ ] The bio link is built by the server from the configured bot username and the creator's own `public_code` (`https://t.me/<bot>?start=c_<code>`, the format US-005 accepts). **Salin Link Profil** copies it and confirms with a toast; if the bot username isn't configured, the card shows a clear "not configured" state instead of a broken link.
- [ ] `/settings/profile` renders `CrEditProfile` with the same rules as US-007 (display name 1–40, bio ≤160, read-only username, Pakai Foto Telegram, Ganti Foto deferred to Phase D). The saved name, bio and photo are what customers see on the creator's public profile (`GET /v1/creators/by-code/:publicCode` returns the updated values).
- [ ] Only a CREATOR can call the creator settings/profile endpoints (`@Roles('CREATOR')`); a USER gets 403. A creator can only read/change their own creator profile — no creator ID is taken from the client. A BLOCKED creator account is rejected.
- [ ] Save failure keeps the typed values and shows the "Perubahan belum tersimpan" banner; screenshots at 390 px match `CrSettings` and `CrEditProfile`.

## Tasks

### TASK-054: Creator contracts, `ProfileService` role scoping, `CreatorSettingsService`
**Status:** done

### TASK-055: Creator API — `GET /v1/creator/settings`, `PATCH /v1/creator/profile`
**Status:** done

### TASK-056: Mini App client + shared `ProfileForm` (no visible change)
**Status:** done

### TASK-057: `/settings` screen (`CrSettings`)
**Status:** done

### TASK-058: `/settings/profile` (`CrEditProfile` + `EditStates`) and visual check
**Status:** done
