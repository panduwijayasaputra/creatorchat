# US-010: Submit a creator request

**Status:** ready_for_uat
**Priority:** high
**Feature:** creator-applications
**Phase:** B
**Roles:** USER
**Brief refs:** §3, §5, §13 (`CreatorApplication` one pending per user; `Subscription`), §15, §17
**Design refs:** `CreatorRequest`, `RequestStates` (validasi / mengirim / gagal, isian dipertahankan), `CreatorRequestBlocked`, `ProfileBlocked`, `Profile`

## Description

As a USER, I want to ask to become a creator through a short form, so that an admin can review me and turn my account into a creator account.

## Acceptance Criteria

- [ ] `/profile/creator-request` renders `CreatorRequest` 1:1: **Nama creator** (prefilled from display name, editable), **Link profil Instagram**, **Jenis creator** (Creator Asli = HUMAN / Karakter AI = AI_CHARACTER), **Deskripsi singkat konten** (max 300, counter), the rights statement checkbox, the info note and **Kirim Permintaan**.
- [ ] The server validates every field: name required (trimmed), Instagram must be an `instagram.com` profile URL ("Link Instagram tidak valid. Contoh: https://instagram.com/namaakun"), type is one of the two values, description required ("Deskripsi wajib diisi.") and ≤300, statement must be checked ("Centang pernyataan ini untuk melanjutkan."). The UI shows the same errors inline (`RequestStates` 1). On success the request is stored as PENDING, the role stays USER, an audit entry is written, and the user goes to the status screen (US-011).
- [ ] One pending request per user, enforced by the database: a second submit while one is pending (double tap, retry, two tabs) does not create another row and returns the existing pending request.
- [ ] If the user has any active or future customer subscription (minimal `Subscription` table added in this story; no grant API yet), submitting is refused with a specific error and the form shows `CreatorRequestBlocked` ("Belum bisa mengajukan … setelah seluruh langganan pelanggan berakhir.", fields and button disabled); `Profile` shows its `ProfileBlocked` variant. No subscription is changed.
- [ ] Only a USER can submit (`@Roles('USER')`; a CREATOR gets 403). The user comes from the session; any `user_id`, `role` or `status` in the body is ignored. A BLOCKED account or stale session is rejected.
- [ ] While sending, fields and button are disabled ("Mengirim..."); on network/server failure the "Permintaan belum terkirim" banner shows and every typed value is kept (`RequestStates` 3). Screenshots at 390 px match `CreatorRequest`, `CreatorRequestBlocked` and `ProfileBlocked`.

## Tasks

### TASK-062: Contracts, migration (`creator_applications`, `subscriptions`) and seed
**Status:** done

### TASK-063: `CreatorRequestService` (backend-core)
**Status:** done

### TASK-064: `GET` and `POST /v1/me/creator-request`
**Status:** done

### TASK-065: `/profile/creator-request` form (`CreatorRequest`, `RequestStates`, `CreatorRequestBlocked`)
**Status:** done

### TASK-066: `Profile` blocked variant (`ProfileBlocked`) and visual checks
**Status:** done
