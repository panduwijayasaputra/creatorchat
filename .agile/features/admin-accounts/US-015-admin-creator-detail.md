# US-015: Admin creator detail (ringkasan and history)

**Status:** ready_for_uat
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin
**Brief refs:** §11 (Creator detail: identity, status, application, contextual action, ringkasan, history with View log; no private chats by default)
**Design refs:** `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrApproved`, `AdmCrHistory`, `AdmTableStates`. Subscriber / Galeri / Persona AI tabs: later phases (C, D, F)

## Description

As an Admin, I want a detail page for each creator request or creator, so that I can check who they are and what has happened before I decide.

## Acceptance Criteria

- [x] `/creators/:id` shows the header (photo/initials, name, status chip, `@username · ID`, Instagram, type, submitted/active-since date in the admin's timezone) and the action for the status: Request → Setujui / Tolak, Active → Block, Blocked → Unblock. The `:id` works for both a pending request and a creator account (the URL tells which).
- [x] **Ringkasan** for a request matches `AdmCrReq`: "Deskripsi pengajuan" (name, Instagram, type, statement) and "Pemeriksaan sebelum menyetujui" (active customer subscription Tidak ada / count with chip, current role, "Riwayat pengajuan" e.g. "Pertama kali" or number of earlier rejections). For an active/blocked creator it matches `AdmCrActive` / `AdmCrBlocked`: active subscriber count from the server, bio/description, Instagram; the media and AI usage cards show "–" until Phases D/F.
- [x] **History** matches `AdmCrHistory`: a server-side table of this person's audit events (joined, applied, approved/rejected, blocked/unblocked, profile changes) with search, Jenis/Status filters, sort, pagination and **View** to a log detail route that shows actor, target, time and zone, reason, safe before/after and request ID. No chat content or secrets appear.
- [x] Subscriber, Galeri and Persona AI tabs are present as designed and show the "belum dibangun" placeholder.
- [x] Unknown or malformed `:id` shows a not-found state; admin-only (user token → 401). Screenshots at 1440 px match `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrHistory`.
- [x] **(wiring from US-012)** The header **Setujui** / **Tolak** open the same dialogs with the request's application id. After an approval the page shows `AdmCrApproved` (`approvedBanner`: "… kini Creator Active") and the Active header; "Pemeriksaan sebelum menyetujui" extends `GET /v1/admin/creator-requests/:id`, which already returns the blocking subscription (count, creator, end date), with the current role and the number of earlier rejections. The `:id` in `/creators/:id` for a request is the application id.

- [x] **Handed over from US-016:** the header Block / Unblock button opens the US-016 `BlockCreatorDialog` / `UnblockCreatorDialog` (API and dialogs already built); a successful block shows `AdmCrBlockedDone`, and the Blocked summary matches `AdmCrBlocked`.

## Tasks

### TASK-091: Creator detail, history and audit-log contracts
**Status:** done

### TASK-092: `CreatorDetailService`
**Status:** done

### TASK-093: `CreatorHistoryService` and `AuditLogService`
**Status:** done

### TASK-094: API endpoints and admin client
**Status:** done

### TASK-095: Detail page: header, tabs, Ringkasan, not found
**Status:** done

### TASK-096: History tab and Detail Log page
**Status:** done

### TASK-097: Header actions: dialogs, `AdmCrApproved`, row links
**Status:** done
