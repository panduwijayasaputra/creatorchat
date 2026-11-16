# Feature: profiles

**Phase:** B — Profiles & applications
**Roles:** USER, CREATOR
**Brief refs:** §3 (Telegram identity, profile is app-only), §5 (edit profile), §10 (customer Profil; creator profile + bot link for bio), §13 (IANA timezone for display)
**Design refs:** `Profile`, `EditProfile`, `EditStates`, `CrSettings`, `CrEditProfile`, `CrTimezone`

## Overview

Every account has an app profile (photo, display name, optional bio) that starts from the Telegram values and can be edited without touching the Telegram account. The Telegram username is read-only. USERs reach it from the Profil tab; CREATORs from Pengaturan, which also gives them the bot link to put in their Instagram bio and a display timezone.

Decisions taken for Phase B (2026-11-16):
- **Avatar upload ("Ganti Foto") is deferred to Phase D** (media storage). Phase B saves name, bio and "Pakai Foto Telegram". The "Ganti Foto" button stays as designed; until Phase D it shows a toast saying photo upload isn't available yet (placeholder copy).
- Persona AI, Pesan selamat datang and Harga subscription rows in `CrSettings` lead to later-phase stories (F, E/C, C); in Phase B they go to the neutral "belum dibangun" placeholder.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-007 | USER profile page and edit profile | high |
| US-008 | Creator settings, edit profile and bio link | high |
| US-009 | Creator display timezone | low |

## Design gaps

- "Kebijakan Privasi" page (linked from `Profile`) is not designed.
- The `Profile` "Notifikasi" toggles belong to notification preferences (Phase E). Phase B shows them as designed but they aren't saved yet; wiring is a Phase E story.
- `CrSettings` "Preview profil" shows a category and city ("Kuliner & slow living · Bandung") and `AdmCrActive` shows "Kategori" / "Kota", but no form in the design collects them (not in `CreatorRequest` or `CrEditProfile`). Not built until the source of those fields is decided.
- Toast copy for "Ganti Foto" before Phase D is not designed (placeholder).
