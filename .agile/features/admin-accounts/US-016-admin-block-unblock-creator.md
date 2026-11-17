# US-016: Admin blocks and unblocks a creator

**Status:** ready_for_uat
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin, System
**Brief refs:** §6 (creator block stops new activity/AI/broadcast and hides from discovery; received history stays), §3 (stale sessions lose privilege), §11 (Active: block; Blocked: unblock; reason recorded)
**Design refs:** `AdmDlgBlock`, `AdmCrBlockedDone`, `AdmCrBlocked`, `AdmDlgUnblock`, `AdmCreatorsToastUnblock`

## Description

As an Admin, I want to block a creator who breaks the rules and unblock them later, so that they stop operating while their history is kept.

## Acceptance Criteria

- [ ] **Block** (list row or detail header) opens `AdmDlgBlock` with the creator card, the consequence text including the server's active subscriber count ("… **58 subscriber aktif** kehilangan akses selama diblokir…"), required **Alasan block (wajib)** and **Block Creator**. Confirming sets the creator BLOCKED and blocks the account through `AccountSecurityService` (sessions revoked, `session_version` bumped), audits with the reason, and shows `AdmCrBlockedDone`.
- [ ] A blocked creator: cannot sign in (US-006 blocked message); is hidden from discovery and `GET /v1/creators/by-code/:code` returns the same 404 as an unknown code; existing messages, subscriptions and history are not deleted. (Subscriber access while blocked is enforced by the Phase C entitlement check.)
- [ ] **Unblock** opens `AdmDlgUnblock`; confirming restores creator and account to ACTIVE, audits it, and the list shows `AdmCreatorsToastUnblock`. Unblock does not re-grant or extend any subscription.
- [ ] The reason is required by the server (empty → 400, dialog keeps the inline error). Blocking an already blocked creator or unblocking an active one returns a conflict and changes nothing; double submit acts once. Buttons are disabled in flight.
- [ ] Admin-only (cookie + CSRF). Integration tests: block revokes the creator's live session, deep link becomes 404, audit row written with reason; unblock reverses status only. Screenshots at 1440 px match the dialog and result boards.

## Tasks

### TASK-086: Contracts for creator moderation
**Status:** done

### TASK-087: CreatorModerationService (backend-core)
**Status:** done

### TASK-088: Admin endpoints
**Status:** done

### TASK-089: Admin API client + Block / Unblock dialogs
**Status:** done

### TASK-090: Wire the list + visual check
**Status:** done
