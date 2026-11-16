# US-015: Admin creator detail (ringkasan and history)

**Status:** backlog
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin
**Brief refs:** §11 (Creator detail: identity, status, application, contextual action, ringkasan, history with View log; no private chats by default)
**Design refs:** `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrApproved`, `AdmCrHistory`, `AdmTableStates`. Subscriber / Galeri / Persona AI tabs: later phases (C, D, F)

## Description

As an Admin, I want a detail page for each creator request or creator, so that I can check who they are and what has happened before I decide.

## Acceptance Criteria

- [ ] `/creators/:id` shows the header (photo/initials, name, status chip, `@username · ID`, Instagram, type, submitted/active-since date in the admin's timezone) and the action for the status: Request → Setujui / Tolak, Active → Block, Blocked → Unblock. The `:id` works for both a pending request and a creator account (the URL tells which).
- [ ] **Ringkasan** for a request matches `AdmCrReq`: "Deskripsi pengajuan" (name, Instagram, type, statement) and "Pemeriksaan sebelum menyetujui" (active customer subscription Tidak ada / count with chip, current role, "Riwayat pengajuan" e.g. "Pertama kali" or number of earlier rejections). For an active/blocked creator it matches `AdmCrActive` / `AdmCrBlocked`: active subscriber count from the server, bio/description, Instagram; the media and AI usage cards show "–" until Phases D/F.
- [ ] **History** matches `AdmCrHistory`: a server-side table of this person's audit events (joined, applied, approved/rejected, blocked/unblocked, profile changes) with search, Jenis/Status filters, sort, pagination and **View** to a log detail route that shows actor, target, time and zone, reason, safe before/after and request ID. No chat content or secrets appear.
- [ ] Subscriber, Galeri and Persona AI tabs are present as designed and show the "belum dibangun" placeholder.
- [ ] Unknown or malformed `:id` shows a not-found state; admin-only (user token → 401). Screenshots at 1440 px match `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrHistory`.
