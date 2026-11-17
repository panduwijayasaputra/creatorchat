# US-024: Admin reviews customer access requests

**Status:** ready_for_uat
**Priority:** high
**Feature:** customer-access
**Phase:** C
**Roles:** Admin, System
**Brief refs:** §6 (access request pending for admin), §11 (dialogs; reason for reject), §13 (AccessRequest review details)
**Design refs:** `AdmUserSubs`, `AdmDlgGrant`, `AdmDlgReject` (pattern), `AdmUsers`; **review UI not designed — gap** (decision 2026-11-16: inside user detail)

## Description

As an Admin, I want to see a user's pending trial or renewal requests and approve or reject them, so that customers get an answer without a separate payment flow.

## Acceptance Criteria

- [ ] The Langganan tab on `/users/:id` shows a banner per PENDING access request (creator name, Uji Coba / Perpanjangan, requested time) with **Setujui** and **Tolak**. The user list (`/users`) shows which users have a pending access request and can filter by it. Banner/filter copy is placeholder until designed (reported as a gap).
- [ ] **Setujui** opens `AdmDlgGrant` pre-filled with that creator (default 30 hari; a renewal is a re-grant starting now, since the old access has ended). Confirming grants access with US-020's rules **and** marks the request APPROVED (admin, time, linked event) in the same transaction.
- [ ] **Tolak** opens a reject dialog following the `AdmDlgReject` pattern with a required reason; confirming marks it REJECTED with reason, admin and time, writes audit + outbox event, and the customer sees the `StatesAccess` rejected state.
- [ ] Granting access directly (US-020) while a request for the same pair is pending also closes that request as APPROVED, so no stale pending request remains.
- [ ] Reviewing a request that is no longer PENDING returns 409 with its current status and changes nothing; double submit acts once. Admin-only (cookie + CSRF). Integration tests cover approve, reject, already-reviewed and grant-closes-request.

## Tasks

### TASK-137: Access request review contracts
**Status:** done

### TASK-138: Migration: event link on access requests
**Status:** done

### TASK-139: Review service, grant and extend close requests
**Status:** done

### TASK-140: User list: pending access count and filter
**Status:** done

### TASK-141: Admin API endpoints and admin client
**Status:** done

### TASK-142: Admin UI: Langganan banners, dialogs and `/users` chip and filter
**Status:** done
