# US-019: Admin blocks and unblocks a user

**Status:** backlog
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin, System
**Brief refs:** §6 (account block is different from subscription expiry), §3 (stale sessions lose privilege), §11 (block/unblock with reason)
**Design refs:** `AdmDlgUserBlock`, `AdmUserBlockedDone`, `AdmUserBlocked`, `AdmDlgUserUnblock`, `AdmUsersToastUnblock`

## Description

As an Admin, I want to block a user who misuses the app and unblock them later, so that they lose access immediately without losing their history.

## Acceptance Criteria

- [ ] **Block** (list row or detail header) opens `AdmDlgUserBlock` with the user card, consequence text and a required reason; confirming blocks the account through `AccountSecurityService` (status BLOCKED, `session_version` bumped, sessions revoked), audits with the reason, and shows `AdmUserBlockedDone`.
- [ ] A blocked user's open Mini App session fails on its next request and they see the blocked-account message (US-006); they can't sign in again. Subscriptions, pending creator requests and history are not deleted or changed.
- [ ] **Unblock** opens `AdmDlgUserUnblock`; confirming restores ACTIVE, audits it, and the list shows `AdmUsersToastUnblock`. Unblock doesn't change subscriptions.
- [ ] Reason required on the server for block (empty → 400, inline error kept). Blocking a blocked user or unblocking an active one returns a conflict and changes nothing; double submit acts once; buttons disabled in flight. This endpoint refuses CREATOR accounts (they are blocked via US-016).
- [ ] Admin-only (cookie + CSRF). Integration tests: block revokes a live user session, unblock lets the user sign in again, audit rows carry the reason. Screenshots at 1440 px match the boards.
