# US-011: Creator request status and resubmission

**Status:** planned
**Priority:** high
**Feature:** creator-applications
**Phase:** B
**Roles:** USER
**Brief refs:** §5 (statuses; rejection keeps the reason; resubmit without deleting history)
**Design refs:** `RequestPending`, `ProfilePending`, `RequestRejected`, `ProfileRejected`, `CreatorRequestRetry`, `RequestApproved` (in-app explanation of the approved state)

## Description

As a USER who asked to become a creator, I want to see where my request stands and, if it was rejected, why — and fix it and apply again — so that I'm not left guessing.

## Acceptance Criteria

- [ ] `Profile` shows the variant matching the latest request: none → "Ingin menjadi creator?" (US-007), pending → `ProfilePending`, rejected → `ProfileRejected`. The status comes from the server, never from local state.
- [ ] The "Status permintaan" screen shows `RequestPending` (chip "Sedang Ditinjau", the submitted values, "Akunmu tetap USER … Permintaan kedua tidak bisa dibuat selama masih ditinjau.", **Kembali ke Profil**) or `RequestRejected` (chip "Ditolak", "Alasan dari admin" with the stored reason, "Akunmu tetap USER…", **Perbaiki dan Ajukan Lagi**, **Kembali ke Profil**). The DEMO strip is not built.
- [ ] **Perbaiki dan Ajukan Lagi** opens `CreatorRequestRetry` prefilled with the rejected request's values. Submitting creates a **new** PENDING request; the rejected one stays unchanged in history (both are visible to admins in US-018).
- [ ] A user can only read their own requests: the status endpoint takes no user or request ID from the client (or scopes it by the session user; another user's ID → 404). A CREATOR calling it gets 403.
- [ ] If the account was approved meanwhile, the next request is rejected as a stale session (US-006) and the Mini App re-authenticates and lands on `/inbox`. Screenshots at 390 px match `RequestPending`, `ProfilePending`, `RequestRejected`, `ProfileRejected`, `CreatorRequestRetry`.

## Tasks

### TASK-067: Seed (pending and rejected fixtures), `instagramHandle` helper, status-read API tests
**Status:** pending

### TASK-068: Status screen `/profile/creator-request/status` (`RequestPending`, `RequestRejected`)
**Status:** pending

### TASK-069: Retry variant of the form (`CreatorRequestRetry`)
**Status:** pending

### TASK-070: Profile variants (`ProfilePending`, `ProfileRejected`) and visual checks
**Status:** pending
