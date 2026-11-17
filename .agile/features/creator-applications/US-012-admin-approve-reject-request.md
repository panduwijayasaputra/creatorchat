# US-012: Admin approves or rejects a creator request

**Status:** ready_for_uat
**Priority:** high
**Feature:** creator-applications
**Phase:** B
**Roles:** Admin, System
**Brief refs:** §3, §5 (transactional re-check; future access must be resolved first), §11 (Request: approve/reject; dialogs with reason), §15, §17
**Design refs:** `AdmDlgApprove`, `AdmDlgApproveLoading`, `AdmDlgApproveFail`, `AdmCrApproved`, `AdmDlgReject`, `AdmDlgRejectEmpty`, `AdmCreatorsToastRej`, `AdmCrReq` ("Pemeriksaan sebelum menyetujui")

## Description

As an Admin, I want to approve or reject a pending creator request with a clear check and a recorded reason, so that only reviewed accounts become creators and the user knows why if not.

**Scope note (2026-11-16):** the decision flow is built here end to end (transaction, API, outbox write, dialogs as components). The dialogs open from the `/creators` list rows and the creator detail header, which are US-014 / US-015; wiring them, the `AdmCreatorsToastRej` toast and `AdmCrApproved` is added to those stories. The bot message is US-013 (events wait in the outbox until then).

## Acceptance Criteria

- [ ] **Setujui** (from `AdmCreators` row or `AdmCrReq` header) opens `AdmDlgApprove`; confirming shows `AdmDlgApproveLoading` and then `AdmCrApproved`. In one transaction the server locks the request and user, re-checks the request is still PENDING, the account is ACTIVE with role USER, and there is **no active or future customer subscription**; then sets the request APPROVED (admin, time), changes the role to CREATOR through `AccountSecurityService` (bumps `session_version`, revokes old sessions), creates the `Creator` row (unique `public_code`, name/type/Instagram from the request), writes the audit entry and an outbox event for the bot (US-013).
- [ ] If the re-check finds an active or future subscription, nothing changes and the dialog shows `AdmDlgApproveFail` with the creator name and end date from the server ("Akun ini masih memiliki 1 langganan pelanggan aktif: Salsa Maheswari, hingga 27 Nov 2026…"), **Setujui Creator** disabled. Seed: Raka Putra.
- [ ] **Tolak** opens `AdmDlgReject`; the reason is required (empty → `AdmDlgRejectEmpty`, also enforced by the server). Confirming sets the request REJECTED with reason/admin/time, keeps the role USER, writes audit + outbox event, and the list shows the `AdmCreatorsToastRej` toast. The rejected request leaves the default creator list but stays in history.
- [ ] Double submit or two admins acting at once: exactly one decision wins; the other gets a conflict error ("already reviewed") and the dialog closes with the current status. Approving a request that isn't PENDING, or a BLOCKED account, is refused.
- [ ] Only an authenticated admin can call these endpoints (admin cookie + CSRF); a user token gets 401. Integration tests prove: approval converts the same account (same user ID/Telegram ID); the user's old session loses USER-only access and a new login lands as CREATOR; a pending/rejected request never changes the role; subscription conflict blocks approval.
- [ ] Screenshots at 1440 px match the dialog boards and `AdmCrApproved`.

## Tasks

### TASK-071: Contracts for the review flow
**Status:** done

### TASK-072: Schema, migration, seed and the outbox writer
**Status:** done

### TASK-073: `CreatorApprovalService` (+ transaction-aware `AccountSecurityService`)
**Status:** done

### TASK-074: Admin endpoints
**Status:** done

### TASK-075: Admin API client and review dialogs
**Status:** done
