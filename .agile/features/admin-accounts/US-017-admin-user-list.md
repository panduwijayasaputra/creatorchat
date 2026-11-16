# US-017: Admin user list

**Status:** backlog
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin
**Brief refs:** §11 (User list: USER role only; status; Telegram; active subscriptions; creator application status; date; View), §11 "Semua tabel", §17
**Design refs:** `AdmUsers`, `AdmTableStates`

## Description

As an Admin, I want a list of all customer accounts, so that I can find a user, see their status and creator-request state, and open their details.

## Acceptance Criteria

- [ ] `/users` renders `AdmUsers` 1:1: columns Pengguna, Telegram (`@username`, ID), Status (Active / Blocked), Langganan aktif (count from the server), Pengajuan creator (Belum mengajukan / Menunggu / Ditolak), Bergabung, Aksi (View + Block or Unblock).
- [ ] Only accounts with role USER are listed; an account that becomes CREATOR leaves this list and appears under Creator (US-014).
- [ ] Search (name or Telegram ID), filters Status akun / Pengajuan creator / Bergabung, column sort and pagination 10/25/50 run on the server with a sort allowlist (unknown value → 400). Totals/range from the server; Reset Filter; page reset on filter change; filters kept in the URL across View and back.
- [ ] View → `/users/:id` (US-018); Block / Unblock → US-019. Loading / empty / no-results / error-with-retry follow `AdmTableStates`.
- [ ] Admin-only (user token → 401); no chat data returned. Integration tests prove filters/sort/pagination change backend results and CREATORs never appear. Screenshot at 1440 px matches `AdmUsers`.
