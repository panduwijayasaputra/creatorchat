# Feature: admin-accounts

**Phase:** B — Profiles & applications
**Roles:** Admin, System
**Brief refs:** §6 (block vs expiry; creator block hides from discovery, keeps history), §11 (Creator list, User list, Creator detail, User detail, all tables, dialogs), §15 (no chat surveillance; IDOR), §17 (filters/sort/pagination are server-side; View routes render real detail; mutations need designed confirmations)
**Design refs:** `AdmCreators`, `AdmCreatorsTablet`, `AdmCreatorsMobile`, `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrBlockedDone`, `AdmCrHistory`, `AdmDlgBlock`, `AdmDlgUnblock`, `AdmCreatorsToastUnblock`, `AdmUsers`, `AdmUserSummary`, `AdmUserBlocked`, `AdmUserBlockedDone`, `AdmUserRequest`, `AdmReqDetail`, `AdmReqDetailRej`, `AdmUserHistory`, `AdmDlgUserBlock`, `AdmDlgUserUnblock`, `AdmUsersToastUnblock`, `AdmTableStates`

## Overview

Admins manage people from two lists. **Creator** is a projection of pending creator requests (label Request; still USER accounts) plus creator accounts (Active / Blocked) — rejected requests are not shown as blocked creators, they live in history. **User** lists USER-role accounts only; an approved creator moves to the Creator list. Each row's **View** opens a real detail page with tabs. Admins can block and unblock creators and users with a required reason; every change is audited and shows in the History tabs.

All tables follow brief §11 "Semua tabel": server-side search/filter/sort (allowlisted)/pagination 10/25/50, total and range, Reset Filter, loading/empty/no-results/error+retry (`AdmTableStates`), filters kept when returning from detail, page reset when filters change.

Tabs that depend on later phases (creator Subscriber / Galeri / Persona AI; user Langganan) show the "belum dibangun" placeholder in Phase B and are completed in Phases C, D, F.

Decision to confirm: **blocking a creator blocks the account too** (Creator status BLOCKED + account BLOCKED via `AccountSecurityService`, sessions revoked), so a blocked creator can't use the app, is hidden from discovery and deep links, and their subscribers lose access while blocked (enforced in Phase C). History is kept.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-014 | Admin creator list | high |
| US-015 | Admin creator detail (ringkasan and history) | high |
| US-016 | Admin blocks and unblocks a creator | high |
| US-017 | Admin user list | high |
| US-018 | Admin user detail, creator requests and history | high |
| US-019 | Admin blocks and unblocks a user | high |

## Design gaps

- `AdmCrActive` cards for media count and AI usage need Phase D/F data; in Phase B they show "–" (placeholder, not designed for "no data yet").
- Category/city ("Kategori", "Kota") on `AdmCrActive` have no input anywhere in the design (see `profiles` feature).
- Admin queue for customer access requests is a Phase C gap, not part of this feature.
