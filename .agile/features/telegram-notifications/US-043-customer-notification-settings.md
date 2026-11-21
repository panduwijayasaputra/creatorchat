# US-043: Customer notification settings and per-creator mute

**Status:** ready_for_uat
**Priority:** medium
**Feature:** telegram-notifications
**Phase:** E
**Roles:** USER
**Brief refs:** §9 (mute per creator, hide preview by default), §10 (pengaturan notifikasi)
**Design refs:** `Profile` (Notifikasi section, currently disabled switches), `Main` ("Bisukan" switch); mute placement not designed — gap

## Description

As a USER, I want to turn message notifications on or off, choose whether the bot shows message content, and mute one creator, so that I control what Telegram tells me.

## Acceptance Criteria

- [ ] On `/profile` the two switches of `Profile` work: "Notifikasi pesan" (default on, "Kabar saat creator membalas.") and "Tampilkan isi pesan" (default off, "Mati secara default. Isi pesan disembunyikan."). Changes save immediately and persist across sessions.
- [ ] A "Bisukan" switch per creator (placement per the design decision) stops message and broadcast notifications from that creator only; unmuting restores them. Access notifications (US-044 / US-045) are not muted.
- [ ] The settings are only for my own account: USER only (CREATOR → 403 `FORBIDDEN_ROLE`), blocked → 401; muting a creator id I have no relation with or a malformed id → 404 and nothing stored.
- [ ] A failed save switches the control back and shows an error; repeated toggles end in the last chosen state (no lost update).

## Tasks

### TASK-234: Contracts and `NotificationPreferencesService`
**Status:** done

### TASK-235: API — preferences and mute endpoints
**Status:** done

### TASK-236: Mini App Notifikasi switches, visual check and docs
**Status:** done
