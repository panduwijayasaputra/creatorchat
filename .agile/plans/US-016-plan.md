# Technical Plan: US-016 — Admin blocks and unblocks a creator

## Architecture Overview

Agreed with the user (2026-11-16, all three recommended options):

1. **Backend complete, dialogs wired to the list; detail-page boards deferred.** The service, API and tests are built in full. `AdmDlgBlock` / `AdmDlgUnblock` are built and wired to the `/creators` row buttons (inert since US-014) with `AdmCreatorsToastUnblock` on the list. `AdmCrBlocked`, `AdmCrBlockedDone` and the detail-header Block / Unblock button live on `/creators/:id`, which is a placeholder until US-015; they move to US-015 as acceptance criteria (same split as US-012). Consequence for UAT: block / unblock is reachable from the list only.
2. **Reason required on both block and unblock.** The `AdmDlgUnblock` board shows "Alasan unblock (wajib)"; the story only demanded the block reason. The board and the "reason for sensitive changes" rule win. Empty → 400 `VALIDATION_FAILED` on both.
3. **Live subscriber count from a pre-check endpoint.** `GET /v1/admin/creators/:id/block-check` returns the active-subscriber count when the dialog opens (the number in "… **58 subscriber aktif** kehilangan akses…"). The block POST re-counts inside its transaction and returns the count it saw, which goes into the audit row.

Defaults taken without asking (say so if you disagree):
- **Endpoints address the creator id** (`creators.id`, the same `id` the list gives for an account row), never a user id.
- **One conflict code** `CREATOR_STATUS_CONFLICT` (409, `details.status` = current `ACTIVE|BLOCKED`) for "already blocked" and "not blocked"; nothing is written.
- **Block and unblock are coupled to the account.** Block sets `creators.status = BLOCKED` and the user BLOCKED through `AccountSecurityService.blockUserInTransaction` (sessions revoked, `session_version` +1, audit `user.account.blocked`). Unblock sets both ACTIVE through `unblockUserInTransaction` (bumps the version again; the creator signs in again). A second audit row `creator.blocked` / `creator.unblocked` (target type `creator`, reason, `changes`, subscriber count on block) is written by the new service.
- **No subscription is touched.** Unblock re-grants nothing; subscriber access while blocked is the Phase C entitlement check. `creators/by-code/:code` already answers the same 404 for a BLOCKED creator or blocked account (US-005), so this story only adds the test.
- **No notification** to the creator or subscribers (no board, no story asks for one).
- **Block-success toast on the list is a design gap** (the board for the block result is the detail page `AdmCrBlockedDone`): the list shows a toast with placeholder copy "{name} diblokir." and the row flips to Blocked. Recorded as a gap, not designed further.

Brief refs: §3, §6, §11, §13 (`AuditLog`), §15. Design refs: `AdmDlgBlock`, `AdmDlgUnblock`, `AdmCreatorsToastUnblock` (list, 1440×1040; dialog card and toast compared), `AdmCrBlocked` / `AdmCrBlockedDone` (US-015).

Slice: contracts → domain service (reusing `AccountSecurityService`) → admin endpoints → admin client → dialogs + list wiring.

## Authorization & Data Rules

- **Who:** authenticated admin only (`@UseGuards(CsrfGuard, AdminJwtGuard)`: cookie + `Origin` + `X-CSRF-Token`). A Telegram user token answers 401. Admin id from the session (`@CurrentAdmin()`), never the body.
- **IDs:** `:id` is `creators.id`. Unknown or malformed → 404 `NOT_FOUND`. Body is `{ reason }` only (other keys stripped). Pre-check is a GET with no side effects, `no-store`.
- **One transaction per decision, fixed lock order** (same as US-012): read the creator's `user_id`, `SELECT … FOR UPDATE` the **user row**, then `SELECT … FOR UPDATE` the **creator row**, then re-check. Two admins or a double click serialise; the loser sees the new status and gets 409 `CREATOR_STATUS_CONFLICT` with nothing written.
- **Block:** creator must be ACTIVE (else 409). Writes: `creators.status = BLOCKED`; account blocked via `AccountSecurityService` (if the account is already BLOCKED the service is a no-op and the creator is still flipped); audit `creator.blocked` with reason, `changes: {status:[ACTIVE,BLOCKED], active_subscribers:n}`. Active subscriber = `revoked_at IS NULL AND starts_at <= now < ends_at` (reuse the list service's definition).
- **Unblock:** creator must be BLOCKED (else 409). Writes: `creators.status = ACTIVE`; account ACTIVE via `AccountSecurityService`; audit `creator.unblocked` with reason. Subscriptions untouched.
- **Reason:** trimmed, 1–300 code points, no control characters except newline (reuse the reject-reason rules). Empty → 400 "Alasan wajib diisi." Reason is admin text: plain text, never logged.
- **After a block:** the creator's live sessions are revoked and the old token fails (401); a new login answers 403 `ACCOUNT_BLOCKED` (US-006); the deep link is the same 404 as an unknown code; messages, subscriptions and history stay.
- **Socket / AI / broadcast** enforcement arrives with Phases C/E/F; they must re-check `creators.status` and account status (already their rule in the brief).

## Dependencies

- No new packages, no migration, no env vars. Prior stories: US-006 (`AccountSecurityService`), US-012 (review-dialog pattern, reason schema, `ConfirmDialog` props), US-014 (list, row actions, toast host), US-005 (deep-link 404).
- Next free task ids: TASK-086…090 (checked against `.agile/features`).

## Risks

- **Lock-order deadlock with approval / account change:** same user → creator order everywhere; covered by a concurrent block/unblock test.
- **Account already BLOCKED when the creator is blocked** (or the reverse on unblock): the service no-ops the account part; creator status still changes. Unblocking an account that an admin blocked for a separate reason would also unblock it; accepted in MVP because creator and account are one decision here, and noted in the UAT notes. A separate user-block story (US-018) may refine this.
- **Subscriber count staleness:** the dialog count is from open time; the POST returns the count it actually saw.
- **No board for the list's block-success toast:** placeholder copy, listed as a gap.
- **Detail page unavailable:** the detail-header button and `AdmCrBlockedDone` are explicitly handed to US-015.

## Tasks

### TASK-086: Contracts for creator moderation

`packages/contracts/src/creator-moderation.ts` (export from `index.ts`) + `creator-moderation.spec.ts`; `errors.ts` adds `CREATOR_STATUS_CONFLICT`.

- `ModerateCreatorSchema = z.object({ reason })` using the shared reason rules (extract or reuse `RejectCreatorRequestSchema`'s reason field; message "Alasan wajib diisi."). Unknown keys stripped.
- `CreatorBlockCheckResponse = { creator_status: 'ACTIVE'|'BLOCKED', active_subscribers: number, checked_at: string }`.
- `BlockCreatorResponse = { creator: { id, status: 'BLOCKED' }, active_subscribers: number }`; `UnblockCreatorResponse = { creator: { id, status: 'ACTIVE' } }`.
- `CreatorStatusConflictDetails = { status: 'ACTIVE'|'BLOCKED' }` (+ Zod schema for the client).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-moderation.ts` | schemas + types |
| CREATE | `packages/contracts/src/creator-moderation.spec.ts` | reason trimmed/required/limits, stripped keys |
| MODIFY | `packages/contracts/src/errors.ts` | `CREATOR_STATUS_CONFLICT` |
| MODIFY | `packages/contracts/src/index.ts` | exports |

**Testing:** empty / whitespace / 301 code points / control characters rejected; `reason` trimmed; extra keys stripped.

---

### TASK-087: CreatorModerationService (backend-core)

`packages/backend-core/src/creator-moderation/creator-moderation.service.ts`, `index.ts` (export from package index). Constructor `(prisma: PrismaClient, accounts: AccountSecurityService, clock = () => new Date())`.

- `getBlockCheck(creatorId): Promise<{ status; activeSubscribers; checkedAt } | null>` (null = unknown id; read-only).
- `block(creatorId, ctx: {adminId, reason, requestId?}): Promise<{kind:'ok'; activeSubscribers} | {kind:'not_found'} | {kind:'conflict'; status}>` — transaction and lock order per the rules above; calls `accounts.blockUserInTransaction(tx, userId, {actor:{type:'ADMIN',id}, reason, requestId})`; writes audit `creator.blocked`.
- `unblock(...)` mirror: `{kind:'ok'} | not_found | conflict`; calls `unblockUserInTransaction`; audit `creator.unblocked`.
- Malformed (non-UUID) id → `not_found`, not a DB error.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-moderation/creator-moderation.service.ts` | domain service |
| CREATE | `packages/backend-core/src/creator-moderation/index.ts` | barrel |
| MODIFY | `packages/backend-core/src/index.ts` | export |
| CREATE | `packages/backend-core/src/creator-moderation/creator-moderation.service.int.spec.ts` | integration tests (`DATABASE_URL_TEST`) |

**Testing (int):** block flips creator + user, bumps `session_version`, revokes live sessions, writes both audit rows with reason and count; subscriptions and messages untouched; blocking again → conflict, no new audit rows; unblock restores ACTIVE on both, grants/extends nothing (subscription rows identical before/after); unblock of an ACTIVE creator → conflict; two concurrent blocks → exactly one `ok`, one audit pair; concurrent block + unblock serialise without deadlock; unknown and malformed ids → `not_found`; active-subscriber count ignores revoked, expired and future subscriptions.

---

### TASK-088: Admin endpoints

Extend `apps/api/src/admin/creators/creators.controller.ts` (module gets a `CREATOR_MODERATION` provider in `tokens.ts`, built from `PrismaService` + `AccountSecurityService`).

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/creators/:id/block-check` | `CsrfGuard + AdminJwtGuard`, `no-store`; 404 `NOT_FOUND` |
| POST | `/v1/admin/creators/:id/block` | body `ModerateCreatorSchema`; 200 `BlockCreatorResponse`; 404; 409 `CREATOR_STATUS_CONFLICT` |
| POST | `/v1/admin/creators/:id/unblock` | same; 200 `UnblockCreatorResponse` |

Admin id and request id from `@CurrentAdmin()` / the request, as in `CreatorRequestsController`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/creators/creators.controller.ts` | three routes |
| MODIFY | `apps/api/src/admin/creators/creators.module.ts` | provider |
| MODIFY | `apps/api/src/admin/creators/tokens.ts` | `CREATOR_MODERATION` |
| CREATE | `apps/api/test/creator-moderation.int.spec.ts` | HTTP integration tests |

**Testing (int):** no cookie / no CSRF / Telegram user token → 401/403; empty reason → 400 on both; block revokes the creator's live token (next `/v1/me` 401) and a new login answers 403 `ACCOUNT_BLOCKED`; `GET /v1/creators/by-code/:code` is the byte-identical 404 of an unknown code while blocked and 200 after unblock; audit row has reason + admin id; second block → 409 and nothing changes; two parallel POSTs → one 200, one 409; block-check returns the live count; ids from another table or malformed → 404; list shows BLOCKED / ACTIVE after the calls.

---

### TASK-089: Admin API client + Block / Unblock dialogs

Extend `apps/admin/src/auth/api-client.ts` (`CreatorModerationApi`: `getBlockCheck(id)`, `blockCreator(id, reason)`, `unblockCreator(id, reason)`; 409 conflict surfaces as `ApiError` with parseable details) and `apps/admin/test/fake-admin-api.ts`.

- `BlockCreatorDialog` = `AdmDlgBlock`: creator identity card (reuse `RequestTarget`-style box with Active chip), consequence text with the live **N subscriber aktif** (bold), required **Alasan block (wajib)** textarea, "Alasan dicatat di audit log.", Batal / **Block Creator**. Loads the pre-check on open (hook like `useRequestReview`); load failure → retry state with placeholder copy (gap, as US-012).
- `UnblockCreatorDialog` = `AdmDlgUnblock`: identity card with Blocked chip, text "Creator kembali Active. Subscriber lama tidak otomatis mendapat akses kembali. Akses harus diberikan ulang oleh admin.", required **Alasan unblock (wajib)**, Batal / **Unblock Creator**.
- Use `ConfirmDialog` (`confirmDisabled`, `pendingLabel`, `onConfirm → false`, required-reason message); buttons disabled in flight; empty reason keeps the dialog open with the inline error; the same Zod schema is applied before the call. 409 `CREATOR_STATUS_CONFLICT` closes the dialog, refetches the list and shows an info toast (placeholder copy). Indonesian copy verbatim from the boards.
- Both dialogs added to `/__preview`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/auth/api-client.ts` | client calls |
| MODIFY | `apps/admin/test/fake-admin-api.ts` | fake endpoints |
| CREATE | `apps/admin/src/creators/BlockCreatorDialog.tsx` (+ `.spec.tsx`) | `AdmDlgBlock` |
| CREATE | `apps/admin/src/creators/UnblockCreatorDialog.tsx` (+ `.spec.tsx`) | `AdmDlgUnblock` |
| CREATE | `apps/admin/src/creators/useBlockCheck.ts` | pre-check loader |
| MODIFY | `apps/admin/src/creators/copy.ts` | dialog + toast copy |
| MODIFY | `apps/admin/src/preview/Preview.tsx` (+ spec) | preview entries |

**Testing:** count shown from the pre-check; empty reason → inline error, no call; success calls the API once and `onDecided`; double click calls once (buttons disabled in flight); failure keeps the dialog and the typed reason; 409 conflict path; pre-check failure + retry.

---

### TASK-090: Wire the list + visual check

`CreatorRowActions` Block / Unblock become live (remove `disabled` / inert title); `CreatorsPage` hosts the dialogs like the approve / reject ones: on success refetch the list (keeping URL view state) and toast — unblock: "{name} kembali Active" (`AdmCreatorsToastUnblock`), block: placeholder "{name} diblokir." (gap). Update `CreatorsPage.spec.tsx`; Playwright screenshots at 1440 px for the two dialogs and the unblock toast compared with `AdmDlgBlock`, `AdmDlgUnblock`, `AdmCreatorsToastUnblock` PNGs. Sync `codebase-map.md` (routes table: Block / Unblock live; endpoints; audit actions) and `design-integration.md` (gap: block-success toast on the list; US-015 inherits `AdmCrBlocked` / `AdmCrBlockedDone` and the detail-header button).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/creators/CreatorRowActions.tsx` | live buttons, `onBlock` / `onUnblock` handlers |
| MODIFY | `apps/admin/src/creators/CreatorsPage.tsx` (+ `.spec.tsx`) | dialog host, refetch, toasts |
| MODIFY | `apps/admin/src/creators/copy.ts` | toast copy |
| MODIFY | `.agile/guidelines/codebase-map.md`, `.agile/guidelines/design-integration.md` | keep in sync |
| MODIFY | `.agile/features/admin-accounts/US-015-admin-creator-detail.md` | add the detail-page acceptance items handed over |

**Testing:** Block on an ACTIVE row opens the dialog, confirm flips the row to Blocked and shows the toast; Unblock on a BLOCKED row restores Active and shows the unblock toast; Block never appears on REQUEST rows; mobile / tablet layouts keep the buttons un-wrapped; visual comparison passes at board size.

---
