# US-018: Admin user detail, creator requests and history

**Status:** ready_for_uat
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin
**Brief refs:** §11 (User detail: identity, status, block/unblock, ringkasan, creator applications + View application, history + View log; no chat surveillance)
**Design refs:** `AdmUserSummary`, `AdmUserBlocked`, `AdmUserRequest`, `AdmReqDetail`, `AdmReqDetailRej`, `AdmUserHistory`, `AdmTableStates`. Langganan tab (`AdmUserSubs*`): Phase C

## Description

As an Admin, I want a detail page for each user with their creator requests and history, so that I can review them without seeing their private chats.

## Acceptance Criteria

- [x] `/users/:id` shows the header (initials/photo, name, status chip, `@username · ID`, joined date) with Block or Unblock. **Ringkasan** matches `AdmUserSummary` / `AdmUserBlocked`: "Profil aplikasi" (display name, bio, username, role), "Ringkasan langganan" (active / expired counts and nearest end from the server; **Kelola Langganan** goes to the Langganan tab), "Status pengajuan creator" (status, submitted, times rejected, **Detail Pengajuan**), and the note "Isi percakapan privat tidak ditampilkan di halaman detail user."
- [x] **Pengajuan Creator** matches `AdmUserRequest`: a banner when a request is pending (and, if an active subscription blocks approval, the reason with creator and end date), plus a server-side table of all this user's requests (Diajukan, Pengajuan ke-n, Status, Ringkasan, View) with search, status filter, sort, pagination.
- [x] View on a request opens `/users/:id/requests/:reqId` matching `AdmReqDetail` (pending, with Setujui/Tolak → US-012) or `AdmReqDetailRej` (rejected, with reason, reviewer and time). A request that doesn't belong to `:id` returns not found.
- [x] **History** matches `AdmUserHistory` with the same table rules and View → log detail as US-015. The Langganan tab shows the "belum dibangun" placeholder until Phase C.
- [x] Admin-only (user token → 401). A CREATOR's ID under `/users/:id` redirects or links to `/creators/:id`; unknown IDs show not found. Screenshots at 1440 px match the boards.
- [x] **Handed over from US-019:** the header Block / Unblock button opens the US-019 `BlockUserDialog` / `UnblockUserDialog` (API and dialogs already built); a successful block shows `AdmUserBlockedDone` (toast "{name} diblokir" and the Blocked summary of `AdmUserBlocked`, including the block reason from the audit row), a successful unblock returns the Active page; a 409 only refetches.

## Tasks

### TASK-102: User detail, requests and history contracts
**Status:** done

### TASK-103: `UserDetailService`, `UserRequestsService`, `UserHistoryService`
**Status:** done

### TASK-104: API endpoints and admin client
**Status:** done

### TASK-105: User detail page: header, tabs, Ringkasan, not found, creator redirect
**Status:** done

### TASK-106: Pengajuan Creator tab and request detail page
**Status:** done

### TASK-107: User History tab
**Status:** done
