# Feature: welcome-message

**Phase:** E — Broadcast & notifications
**Roles:** CREATOR, USER, System
**Brief refs:** §6 (sent only with active access), §8B (media: Pilih Galeri = same asset; Upload Baru = not in gallery), §14 (outbox, idempotent worker); design-integration Resolved Conflict #5 (binding)
**Design refs:** `CrWelcome`, `CrWelcomePick`, `CrWelcomeGallery`, `CrWelcomeUpload`, `CrSettings` (row "Pesan selamat datang · Aktif")

## Overview

A creator writes one welcome message (text + optional photo or video) and switches it on. Each customer who gets access to that creator **for the first time** receives it once, as a normal creator message with no label, written in the creator's name. It is not sent again on extend, renewal or re-grant, it does not change AI/Manual mode, and it is not sent if the access is no longer active when the worker delivers it. Hooks into the existing `subscription.granted` outbox event (US-020 / US-024).

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-040 | Creator sets the welcome message | medium |
| US-041 | Welcome message delivered once to each new subscriber | medium |

## Depends on

- US-020 / US-024 (`subscription.granted` outbox event), US-032 / US-036 (upload, gallery picker, media message), US-031 (realtime).

## Decisions to confirm with the Tech Lead

- "First access" = the customer has no earlier subscription with this creator (a re-grant after expiry or revoke does not send it again).
- The message sent is the welcome message as saved **at delivery time**; later edits do not change already-sent messages.

## Design gaps

- The board text is sample copy; an **empty** text field: allowed with media only? Placeholder: text required (1–2000) when the switch is on, media optional.
- Saved / failed-save feedback after "Simpan Pesan": no board (placeholder toast "Pesan selamat datang disimpan.", like `CrPriceSaved`).
- `CrSettings` row status when switched off: board shows "Aktif" only (placeholder "Mati").
