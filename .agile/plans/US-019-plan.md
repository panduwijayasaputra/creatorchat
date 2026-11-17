# Technical Plan: US-019 — Admin blocks and unblocks a user

## Architecture Overview

Agreed with the user (2026-11-16, both recommended options):

1. **Backend + dialogs + list now; detail-page pieces handed to US-018.** The service, API and tests are built in full. `AdmDlgUserBlock` / `AdmDlgUserUnblock` are built and wired to the `/users` row buttons (inert since US-017), with `AdmUsersToastUnblock` on the list. The detail-header Block / Unblock button, `AdmUserBlocked` and `AdmUserBlockedDone` live on `/users/:id`, which does not exist yet (US-018): those acceptance items are added to US-018.
2. **Subscriptions are never touched.** The two dialog boards disagree (Block: active subscriptions are "ditangguhkan, bukan dicabut, dan berlanjut setelah di-unblock"; Unblock: "tidak ada akses langganan yang dipulihkan secara otomatis"). Block and unblock write no subscription (no pause, no extension, nothing re-granted); access while blocked is enforced by the account status in Phase C. Both texts are shown **verbatim** and the contradiction is recorded as a **design gap** for the designer.

Defaults taken without asking (say so if you disagree):
- **Endpoints address the user id** (`users.id`, the `id` of a `/users` list row), never a creator id.
- **Reason required on both block and unblock** (the unblock board shows "Alasan unblock (wajib)"), same rules as the creator reason.
- **One audit row per action**, written by `AccountSecurityService` (`user.account.blocked` / `user.account.unblocked`, with the reason). Unlike creators there is no second domain row.
- **CREATOR accounts are refused** by these endpoints (they are blocked through US-016): 409 `USER_ROLE_CONFLICT`. A user with a pending creator request can be blocked; the request stays PENDING and an approval of a blocked applicant already fails (US-012).
- **Two conflict codes** (409, nothing written): `USER_STATUS_CONFLICT` (`details.status` = current `ACTIVE|BLOCKED`) for "already blocked" / "not blocked", and `USER_ROLE_CONFLICT` (`details.role`).
- **No notification** to the user (no board, no story asks for one).
- **Block result on the list:** a toast "{name} diblokir" (the wording of the `AdmUserBlockedDone` toast); unblock: "{name} kembali Active" (`AdmUsersToastUnblock`).

How it works:

```
GET  /v1/admin/users/:id/block-check   → { user_status, role, active_subscriptions, checked_at }   (dialog on open)
POST /v1/admin/users/:id/block         { reason } → UserModerationService.block → AccountSecurityService.blockUserInTransaction
POST /v1/admin/users/:id/unblock       { reason } → …unblockUserInTransaction
/users row Block / Unblock ──▶ BlockUserDialog / UnblockUserDialog ──▶ refetch the list + toast
```

Brief refs: §3 (stale sessions lose privilege), §6 (an account block is not a subscription expiry), §11, §13 (`AuditLog`), §15. Design refs: `AdmDlgUserBlock`, `AdmDlgUserUnblock`, `AdmUsersToastUnblock` (list, 1440×1040; dialog card and toast compared); `AdmUserBlocked` / `AdmUserBlockedDone` (US-018).

Slice: contracts → domain service (reusing `AccountSecurityService`) → admin endpoints → admin client + dialogs → list wiring.

## Authorization & Data Rules

- **Who:** authenticated admin only (`CsrfGuard` + `AdminJwtGuard`: cookie, `Origin`, `X-CSRF-Token`; the block-check GET needs no CSRF). A Telegram user token is 401. The admin id comes from the session (`@CurrentAdmin()`), never the body.
- **IDs:** `:id` is `users.id`. Unknown or malformed → 404 `NOT_FOUND` (an admin account id, a creator id or an application id never resolves). Body is `{ reason }` only; other keys are stripped.
- **One transaction per decision.** The user row is locked first (`SELECT … FOR UPDATE`), which is the same first lock the approval and creator-moderation transactions take, so there is no new lock order: two admins, a double click, a concurrent approval and a concurrent creator block serialise. Then re-check: role must be `USER` (else `USER_ROLE_CONFLICT`), status must be `ACTIVE` for block / `BLOCKED` for unblock (else `USER_STATUS_CONFLICT`), then call `AccountSecurityService` (`session_version` + 1, live sessions revoked, audit with the reason, request id).
- **Block** therefore revokes the user's sessions: the Mini App's next request fails and they see the blocked-account message (US-006); sign-in answers 403 `ACCOUNT_BLOCKED`. **Unblock** bumps the version again and lets them sign in; nothing else changes.
- **Not touched:** subscriptions, creator applications (a PENDING request stays PENDING), messages, history.
- **Reason:** trimmed, 1–300 code points, no control characters except newline (the shared `ReasonSchema`). Empty → 400 "Alasan wajib diisi." Plain text; never logged.
- **Block-check:** read-only, `no-store`: `active_subscriptions` = subscriptions of the user as customer that are started, not ended and not revoked (the same rule as the list column). The block POST does not need the count (nothing is stored about it).
- **Idempotency:** double submit acts once (the second sees the new status → 409 with nothing written; the dialog disables its buttons in flight).
- **Events / outbox / sockets:** none now. The Phase C gateway must disconnect live sockets of a blocked user (already a rule in `backend.md`).

## Dependencies

- No new packages, no migration, no env. Prior stories: US-006 (`AccountSecurityService`, blocked message), US-012 (reason schema, `ConfirmDialog` props, dialog pattern), US-016 (`CreatorModerationService`, `BlockCreatorDialog` pattern, `useBlockCheck`, toast host), US-017 (`/users` list, row actions).
- Task ids TASK-108…112 (US-018 holds 102–107; checked against `.agile/features`).

## Risks

- **Blocking a creator through the wrong door:** the role check inside the locked transaction (covered by a test that approves a request, then tries to block through this endpoint).
- **Unblocking someone an admin blocked as a creator:** creators never reach this endpoint, so the creator flow keeps its own account coupling.
- **Contradictory board copy** about subscriptions: shown as designed, behaviour is "untouched", recorded as a gap.
- **Zero active subscriptions:** the board's sentence assumes at least one; with none it is left out (placeholder behaviour, flagged).
- **Detail page unavailable:** the detail-header button, `AdmUserBlocked` and `AdmUserBlockedDone` are explicitly handed to US-018.

## Tasks

### TASK-108: Contracts for user moderation

`packages/contracts/src/user-moderation.ts` (export from `index.ts`) + `user-moderation.spec.ts`; `errors.ts` adds `USER_STATUS_CONFLICT` and `USER_ROLE_CONFLICT`.

- `ModerateUserSchema = z.object({ reason: ReasonSchema })` (the shared reason rules, message "Alasan wajib diisi."; unknown keys stripped).
- `UserBlockCheckResponseSchema` (strict): `{ user_status: 'ACTIVE'|'BLOCKED', role: 'USER'|'CREATOR', active_subscriptions: number, checked_at: string }`.
- `BlockUserResponseSchema` `{ user: { id, status: 'BLOCKED' } }`, `UnblockUserResponseSchema` `{ user: { id, status: 'ACTIVE' } }`.
- `UserStatusConflictDetailsSchema` `{ status: 'ACTIVE'|'BLOCKED' }` and `UserRoleConflictDetailsSchema` `{ role: 'USER'|'CREATOR' }`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/user-moderation.ts`, `user-moderation.spec.ts` | schemas |
| MODIFY | `packages/contracts/src/errors.ts` | two conflict codes |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:** reason empty / whitespace / 301 code points / control characters rejected, trimmed, extra keys stripped; response schemas strict; the new error codes are distinct and present.

---

### TASK-109: `UserModerationService` (backend-core)

`packages/backend-core/src/user-moderation/user-moderation.service.ts`, `index.ts` (export from the package index). Constructor `(prisma, accounts: AccountSecurityService, clock = () => new Date())`.

- `getBlockCheck(userId): Promise<{ status; role; activeSubscriptions; checkedAt } | null>` (null = unknown or malformed id; read-only).
- `block(userId, ctx: { adminId; reason; requestId? }): Promise<{ kind: 'ok' } | { kind: 'not_found' } | { kind: 'role_conflict'; role } | { kind: 'conflict'; status }>`: transaction, lock the user row, re-check role then status, call `accounts.blockUserInTransaction(tx, userId, { actor: { type: 'ADMIN', id: adminId }, reason, requestId })`.
- `unblock(...)` mirror (`unblockUserInTransaction`).
- Malformed (non-UUID) id → `not_found`, never a DB error.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/user-moderation/user-moderation.service.ts`, `.int.spec.ts`, `index.ts` | service |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL):** block sets BLOCKED, bumps `session_version`, revokes live sessions, writes one `user.account.blocked` audit row with admin id, reason and request id; subscriptions, applications (a PENDING request stays PENDING), messages untouched (rows identical before and after); blocking again → conflict, no new audit row; unblock restores ACTIVE, bumps the version, writes `user.account.unblocked`, changes no subscription; unblock of an ACTIVE user → conflict; a CREATOR user → `role_conflict` for block and unblock with nothing written; two concurrent blocks → exactly one `ok` and one audit row; concurrent block + unblock serialise without deadlock; a block racing an approval of the same applicant: either the approval wins (the user becomes CREATOR, the block gets `role_conflict`) or the block wins (the approval answers not-eligible), never both; unknown and malformed ids → `not_found`; the active-subscription count ignores revoked, expired and future subscriptions.

---

### TASK-110: Admin endpoints

Extend `apps/api/src/admin/users/users.controller.ts` (module gets a `USER_MODERATION` provider in `tokens.ts`, built from `PrismaService` + `AccountSecurityService`).

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/users/:id/block-check` | `CsrfGuard + AdminJwtGuard`, `no-store`; 404 `NOT_FOUND` |
| POST | `/v1/admin/users/:id/block` | body `ModerateUserSchema`; 200 `BlockUserResponse`; 404; 409 `USER_STATUS_CONFLICT` / `USER_ROLE_CONFLICT` |
| POST | `/v1/admin/users/:id/unblock` | same; 200 `UnblockUserResponse` |

The admin id and request id come from `@CurrentAdmin()` and the request, as in `CreatorRequestsController`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/users/users.controller.ts`, `users.module.ts`, `tokens.ts` | three routes, provider |
| CREATE | `apps/api/test/user-moderation.int.spec.ts` | HTTP integration tests |

**Testing (integration):** no cookie / no CSRF / Telegram user token → 401/403; empty reason → 400 on both; block revokes the user's live token (next `/v1/me` → 401) and a new login answers 403 `ACCOUNT_BLOCKED`; unblock lets the user sign in again; the audit rows carry the reason and the admin id; second block → 409 `USER_STATUS_CONFLICT` and nothing changes; two parallel POSTs → one 200, one 409; a CREATOR's id → 409 `USER_ROLE_CONFLICT`; block-check returns the live count; ids of a creator, an admin or an application, and malformed ids → 404; the user list shows BLOCKED / ACTIVE after the calls; subscriptions unchanged.

---

### TASK-111: Admin API client + Block / Unblock user dialogs

Extend `apps/admin/src/auth/api-client.ts` (`UserModerationApi`: `getUserBlockCheck(id)`, `blockUser(id, reason)`, `unblockUser(id, reason)`; 409 surfaces as `ApiError` with parseable details) and `apps/admin/test/fake-admin-api.ts`.

- `BlockUserDialog` = `AdmDlgUserBlock`: user identity card (`UserTarget`: initials disc or photo, name, `@username · ID n`, Active chip), the board text "User tidak bisa membuka aplikasi selama diblokir. Langganan aktif (**N**) ditangguhkan, bukan dicabut, dan berlanjut setelah di-unblock." with the live count (with N = 0 the second sentence is left out: placeholder, flagged), required **Alasan block (wajib)** textarea, "Alasan dicatat di audit log.", Batal / **Block User**. The pre-check loads on open (`useUserBlockCheck`, like `useBlockCheck`); failure → retry state with the US-012 placeholder copy.
- `UnblockUserDialog` = `AdmDlgUserUnblock`: card with the Blocked chip, text "User dapat membuka aplikasi kembali. Tidak ada akses langganan yang dipulihkan secara otomatis.", required **Alasan unblock (wajib)**, Batal / **Unblock User**.
- `ConfirmDialog` props as in US-012/016 (`confirmDisabled`, `pendingLabel`, `onConfirm → false`, required-reason message); buttons disabled in flight; empty reason keeps the dialog open with the inline error (the same Zod schema runs before the call); a 409 closes the dialog, refetches the list and shows an info toast (placeholder copy); the thrown message is never shown.
- Copy verbatim from the boards; the Block / Unblock subscription texts are exactly as designed (design gap recorded).
- Both dialogs are added to `/__preview`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client calls |
| CREATE | `apps/admin/src/users/BlockUserDialog.tsx`, `UnblockUserDialog.tsx`, `UserTarget.tsx`, `useUserBlockCheck.ts` (+ specs) | dialogs |
| MODIFY | `apps/admin/src/users/copy.ts` | dialog and toast copy |
| MODIFY | `apps/admin/src/preview/Preview.tsx` (+ spec) | preview entries |

**Testing:** the count comes from the pre-check (N = 1 text, N = 0 text); empty reason → inline error and no call; success calls the API once and `onDecided`; a double click calls once; failure keeps the dialog and the typed reason; 409 status and role conflicts; pre-check failure + retry; applicant text rendered as text.

---

### TASK-112: Wire the users list + visual check

`UserRowActions` Block / Unblock become live (remove `disabled` / inert title); `UsersPage` hosts the dialogs like `CreatorsPage` does: on success refetch the list (keeping the URL view state) and toast: unblock "{name} kembali Active" (`AdmUsersToastUnblock`), block "{name} diblokir"; a conflict only refetches with an info toast. Update `UsersPage.spec.tsx`. Playwright at 1440 px for the two dialog cards and the unblock toast against `AdmDlgUserBlock`, `AdmDlgUserUnblock` and `AdmUsersToastUnblock`. Sync `codebase-map.md` (users route: Block / Unblock live; endpoints; audit actions), `design-integration.md` (gap: the block and unblock dialogs contradict each other about subscriptions; zero-subscription wording) and add the detail-page acceptance items handed over to `US-018` (header button, `AdmUserBlocked`, `AdmUserBlockedDone`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/users/UsersPage.tsx`, `UsersPage.spec.tsx` | live buttons, dialog host, refetch, toasts |
| MODIFY | `visual/specs/visual.spec.ts` | screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md`, `.agile/guidelines/design-integration.md` | keep in sync |
| MODIFY | `.agile/features/admin-accounts/US-018-admin-user-detail.md` | handed-over acceptance items |

**Testing:** Block on an Active row opens the dialog, confirming flips the row to Blocked with the toast; Unblock on a Blocked row restores Active with the unblock toast; filters / sort / page stay in the URL across a decision; a 409 only refreshes; Block never opens on a creator (creators are not in the list); mobile / tablet layouts keep the buttons on one line; Playwright comparison passes at board size.

---

## Implementation order

TASK-108 → TASK-109 → TASK-110 → TASK-111 → TASK-112 (rebuild `contracts` and `backend-core` before the API and admin see them).

## Open inputs

- **Design gap:** the Block board says active subscriptions "berlanjut setelah di-unblock" while the Unblock board says no subscription access is restored automatically; behaviour is "subscriptions untouched" and both texts are verbatim. The zero-subscription sentence is placeholder wording.
- `AdmUserBlocked`, `AdmUserBlockedDone` and the detail-header button wait for US-018 (acceptance items added there).
- Socket disconnects for a blocked user arrive with the Phase C gateway.
- At story completion (dev-team): `codebase-map.md`, QA reports, `completed.json`, `sprint.json`.
