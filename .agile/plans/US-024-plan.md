# Technical Plan: US-024 — Admin reviews customer access requests

> Task ids 137–142 (133–136 belong to US-023). Builds on US-020 (`SubscriptionAccessService`, `AdmUserSubs`, `AdmDlgGrant`), US-021 (access events, audit link), US-022 / US-023 (`access_requests`, the customer submit, `last_review`), US-012 (`RejectRequestDialog`, `ConfirmDialog`), US-017 (`/users`). The Telegram message to the customer is Phase E; the outbox events written here have no consumer yet.

## Architecture Overview

Agreed with the user (2026-11-17, recommended options):

1. **A migration adds `access_requests.subscription_event_id`** (nullable FK → `subscription_events`, RESTRICT): the access event an approval produced. Set on approval and on the automatic close of a same-pair request.
2. **`/users` gets a per-row chip and a filter** for pending access requests (placeholder design, reported as a gap).

```
GET  /v1/admin/users/:id/access-requests              → AccessRequestReviewService.listPending(userId)       (banners)
POST /v1/admin/users/:id/subscriptions                → SubscriptionAccessService.grant(…, {accessRequestId?}) (Setujui + direct grant)
POST /v1/admin/users/:id/access-requests/:requestId/reject {reason} → AccessRequestReviewService.reject(…)     (Tolak)
GET  /v1/admin/users?access=pending                   → UserListService (pending_access_count per row)

/users/:id/subscriptions   banners (Setujui → AdmDlgGrant pre-filled, Tolak → reject dialog)
/users                     "Permintaan akses" chip + filter
```

- **Approval is a grant.** "Setujui" opens the existing `GrantAccessDialog` with the creator fixed (`lockedCreator`, default 30 hari) and posts the ordinary grant with an extra optional `access_request_id`. There is no separate approve endpoint, so one code path decides access (US-020 rules: customer ACTIVE USER, creator ACTIVE, no running access, reason required). A renewal is a re-grant starting now, as US-020 already does.
- **Closing the request, same transaction as the access change.** After the event row exists, `UPDATE access_requests SET status='APPROVED', reviewed_by_admin_id, reviewed_at = now, subscription_event_id = <event> WHERE customer_id AND creator_id AND status='PENDING'` runs in **every** grant and extend that results in active access, with or without a request id. That is the "direct grant closes the pending request" rule and removes the stale-pending risk handed over from US-023. One audit row `access.request.approved` (target the request; `changes`: `subscription_event_id`, `via: 'request' | 'direct'`; no reason of the customer exists).
- **With an `access_request_id`** the request row is locked first (order: customer user row → creator row → access request row → subscription row, extending US-020's order) and must be this customer's, for this creator, and PENDING. A mismatched pair is the same 404 as unknown ids; **not PENDING** → 409 `ACCESS_REQUEST_ALREADY_REVIEWED` with `details.status`, nothing written, so a double submit or a second admin acts once.
- **Reject** is its own endpoint: customer user row locked (role USER, status not required: rejecting a blocked customer's request is harmless), then the request row; must be PENDING and the customer's. Writes REJECTED with `review_reason`, admin and time, an audit row `access.request.rejected` (with the reason, as other admin decisions) and one outbox event `access_request.rejected` (ids and type only, never the reason), dedupe key `access_request:<id>:rejected`. The customer's profile already turns into the `StatesAccess` rejected card through `last_review` (US-023); "Ajukan Lagi" creates a new row, history is kept.
- **Banner data** is read, not derived in the browser: `listPending(userId)` returns the user's PENDING requests with the creator's display name, type and `requested_at`, oldest first (a customer can have one per creator, at most a handful).
- **User list:** the projection gains `pending_access_count` (count of PENDING requests whose creator row and account are ACTIVE, so a request to a blocked creator does not light the chip); the query gains `access` (`any|pending`, default `any`, strict). Sorting is unchanged.
- **History:** the three actions `access.request.created|approved|rejected` get fixed Indonesian labels in `audit-labels.ts` and appear in the user History under the "Akses" type (target type `access_request` joins the user's History query through the request's `customer_id`).

Brief refs: §6, §11 (dialogs, reason for reject), §13 (`AccessRequest` review details), §17. Design refs: `AdmUserSubs`, `AdmDlgGrant`, `AdmDlgReject` / `RejectRequestDialog` (pattern), `AdmUsers`. **Gaps (no boards, placeholder copy, reported):** the pending-request banner on the Langganan tab, the access-request reject dialog text, its success toasts and conflict message, the `/users` chip and filter, and the History labels.

Out of scope: any customer notification (Phase E), a creator-side or global queue screen, bulk review, changing a reviewed request.

## Authorization & Data Rules

- **Principal:** admin only: `@UseGuards(CsrfGuard, AdminJwtGuard)`, no admin id in any request (it comes from the session), `no-store`. A customer or creator token cannot reach these routes (different guard and audience).
- **Scoping:** the request id is always checked against `:id` (the customer) in the SQL; a request of another customer, a creator id, an admin id, a malformed id and an unknown id are one identical 404. A grant's `creator_id` must match the request's creator.
- **Idempotency:** the row lock plus the `status = 'PENDING'` re-check inside the transaction; the second submit gets 409 (`ACCESS_REQUEST_ALREADY_REVIEWED` or, for a grant, the existing `SUBSCRIPTION_ACTIVE`). The partial unique index is unchanged.
- **Review CHECK** (existing): APPROVED needs `reviewed_at`, REJECTED needs `reviewed_at` and a 1–300 character reason, PENDING has no review fields; the new column is also NULL while PENDING (CHECK extended: `subscription_event_id IS NULL` unless APPROVED).
- **Events:** outbox `access_request.rejected` (new); approval emits the existing `subscription.granted` / `.extended`. No consumer, no socket.
- **What leaves the server:** admin responses show the customer's and creator's display names and the request's type and times; never the customer's Telegram id beyond what user detail already shows, never another customer's data.

## Dependencies

- Prior stories: US-020 / US-021 / US-022 / US-023, US-012 (reject dialog pattern), US-017.
- No packages, no env. **One migration** `20261125010000_access_request_event_link` (column, index `(subscription_event_id)`, CHECK). New error code `ACCESS_REQUEST_ALREADY_REVIEWED`. Seed: the existing pending request (Raka Putra → Dinda) is enough for the banner.
- Next free task ids after this plan: 143.

## Risks

- **Lock order / deadlock:** a fixed order (customer user → creator → access request → subscription) in grant and reject; tests run grant-with-request against reject, and two grants, in parallel.
- **A request closed by a grant the admin did not intend as an approval:** by design (AC); the audit row says `via: 'direct'`.
- **Stale banner:** the request was rejected or approved elsewhere: the 409 carries the current status and the page refetches.
- **Blocked creator / customer with a pending request:** grant keeps refusing (`CREATOR_NOT_ACTIVE`, `USER_STATUS_CONFLICT`); the banner stays so the admin can reject; the list chip ignores requests to blocked creators.
- **User list cost:** one extra grouped count in the existing single projection, no per-row queries; tests assert the filter and the count on a seeded set.
- **Placeholder UI:** banner, dialog and chip copy are marked in `copy.ts` and in `design-integration.md` "Known Gaps"; the dialog reuses `ConfirmDialog` / `RejectRequestDialog` pieces, not a new visual language.

## Tasks

### TASK-137: Access request review contracts

`packages/contracts/src/access-request-review.ts` (+ spec, exported):

- `AccessRequestsResponseSchema` `{ items: [{ id, creator: { id, display_name }, type: 'TRIAL' | 'RENEWAL', requested_at }] }` (strict, uuid ids).
- `RejectAccessRequestSchema` `{ reason }` (trimmed 1–300 code points, empty → "Alasan wajib diisi.", other keys stripped, same helper as the other reasons); `RejectAccessRequestResponseSchema` `{ request: { id, status: 'REJECTED' } }`.
- `GrantAccessSchema` (US-020) gains optional `access_request_id: z.uuid()`; `SubscriptionActionResponse` unchanged.
- `ErrorCode.ACCESS_REQUEST_ALREADY_REVIEWED` with `AccessRequestConflictDetails { status: 'APPROVED' | 'REJECTED' }`.
- `UserListQuerySchema` gains `access: 'any' | 'pending'` (strict, default `any`); `UserListRowSchema` gains `pending_access_count` (int ≥ 0).
- Path helpers `userAccessRequestsPath(id)`, `rejectAccessRequestPath(id, requestId)`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/access-request-review.ts`, `.spec.ts` | schemas, paths |
| MODIFY | `packages/contracts/src/subscription-access.ts` (+ spec), `errors.ts`, `user-list.ts` (+ spec), `index.ts` | grant body, error code, list query / row |

**Testing:** reason rules (empty, whitespace, 301 code points, emoji count by code point, extra keys stripped); `access_request_id` must be a uuid; the old grant body still parses and still needs exactly one of duration / end date; list query accepts `access=pending` and refuses `access=all`, repeated or unknown keys; strict objects refuse leaked keys (`customer_id`, `admin_id`, `review_reason`).

---

### TASK-138: Migration: event link on access requests

Migration `20261125010000_access_request_event_link` and `schema.prisma`: `access_requests.subscription_event_id uuid NULL` → `subscription_events(id)` ON DELETE RESTRICT, index, and the extended review CHECK (the column is NULL unless `status = 'APPROVED'`). Relation on `SubscriptionEvent` (`accessRequests`). Seed unchanged.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/20261125010000_access_request_event_link/migration.sql` | column, FK, index, CHECK |
| MODIFY | `packages/db/prisma/schema.prisma` | field + relation |
| MODIFY | `packages/db/seed/seed.int.spec.ts` (or the db integration spec that covers `access_requests`) | constraint tests |

**Testing (db integration):** migration applies on the test DB; a PENDING or REJECTED row with an event id is refused; an APPROVED row with and without one is allowed; RESTRICT on deleting a linked event (the events table is append-only anyway); existing rows unaffected. Run `pnpm db:migrate` on the dev database only; never `migrate reset` a database you did not create.

---

### TASK-139: Review service, grant and extend close requests

`packages/backend-core/src/access-request-review/` and `subscription-access/`:

```ts
class AccessRequestReviewService {
  constructor(prisma: PrismaClient, outbox: OutboxService, clock?: () => Date)
  listPending(userId: string): Promise<{ kind: 'ok'; items: PendingAccessRequest[] } | { kind: 'not_found' }>
  reject(userId: string, requestId: string, input: { reason: string }, context: { adminId: string; requestId?: string }):
    Promise<{ kind: 'ok'; requestId: string } | { kind: 'not_found' } | { kind: 'already_reviewed'; status: 'APPROVED' | 'REJECTED' }>
}
```

- `SubscriptionAccessService.grant(userId, input: GrantInput & { accessRequestId?: string }, context)`: after the creator lock and before the subscription work, when `accessRequestId` is given, lock the request row (`FOR UPDATE`; customer and creator must match, else `not_found`; not PENDING → `{ kind: 'request_reviewed', status }`). After `record()` creates the event, a private `closePendingRequest(tx, userId, creatorId, adminId, eventId, via)` marks the pair's PENDING request APPROVED (sets `subscription_event_id`), writes audit `access.request.approved`. Called by `grant` always and by `extend` when the result is active access.
- `AccessOutcome` gains `{ kind: 'request_reviewed'; status }`; `record()` returns the event id.
- `reject`: lock customer user row (`role = 'USER'`, else `not_found`), lock the request row, check ownership and PENDING, update to REJECTED with reason / admin / time, audit `access.request.rejected` (reason included), outbox `access_request.rejected` (`OutboxEventType`, payload ids and type only).
- Audit labels for the three `access.request.*` actions, and History: user History includes audit rows targeting the user's access requests (`audit-labels.ts`, `listHistory`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/access-request-review/access-request-review.service.ts`, `.int.spec.ts`, `index.ts` | list and reject |
| MODIFY | `packages/backend-core/src/subscription-access/subscription-access.service.ts` (+ int spec) | request id, auto-close in grant / extend |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | `ACCESS_REQUEST_REJECTED` |
| MODIFY | `packages/backend-core/src/creator-detail/audit-labels.ts`, the shared `listHistory` (+ specs), `index.ts` | labels, History |

**Testing (integration, real PostgreSQL, injected clock):**
- *Approve:* grant with the request id → access created, request APPROVED with admin, time and the event id, one `access.request.approved` audit (`via: 'request'`); renewal (expired + pending) re-grants from now; a request for another creator, another customer's request, a malformed or unknown id → `not_found`, nothing written.
- *Direct grant closes:* grant without an id while the pair is pending → request APPROVED (`via: 'direct'`); no pending → nothing extra; extending an expired access that makes it active closes the pending request; a grant for another creator leaves it untouched.
- *Reject:* REJECTED with reason / admin / time, audit with the reason, one outbox event of ids only (no reason in the payload), customer's `last_review` becomes REJECTED and a new submit creates a second row; a second reject and a reject after approval → `already_reviewed` with the current status, nothing changed; double submit in parallel acts once; another customer's request → `not_found`; a creator account id → `not_found`; a blocked customer's request can be rejected.
- *Concurrency:* grant-with-request vs reject in parallel → exactly one wins, the other gets `request_reviewed` / `already_reviewed`; no deadlock over 20 repeated runs.
- `listPending`: only this user's PENDING rows, oldest first, with the creator name, nothing about other customers; a creator id → `not_found`.
- History shows the three labels; no raw JSON, no reason leaks into the created / approved rows.

---

### TASK-140: User list: pending access count and filter

`packages/backend-core/src/user-list/user-list.service.ts`: the single projection adds `pending_access_count` (PENDING requests whose creator and creator account are ACTIVE); the `access` query adds `WHERE pending_access_count > 0`; the response carries the count.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/user-list/user-list.service.ts`, `user-list.service.int.spec.ts` | count and filter |

**Testing (integration):** counts per user; a request to a blocked creator or blocked creator account is not counted; approved / rejected rows are not counted; `access=pending` returns only users with a count, `total` and paging follow the filter; combined with `q`, `status` and `request` filters; ordering and the other columns unchanged; no per-row query (one projection, asserted by row-count equality on a seeded set).

---

### TASK-141: Admin API endpoints and admin client

- `apps/api/src/admin/user-subscriptions/` (guards `CsrfGuard` + `AdminJwtGuard`):
  - `GET users/:id/access-requests` → banners, 404 identical for unknown / non-USER ids.
  - `POST users/:id/access-requests/:requestId/reject` (`ZodValidationPipe(RejectAccessRequestSchema)`) → 200 `{ request: { id, status } }`, 404, 409 `ACCESS_REQUEST_ALREADY_REVIEWED` (`details.status`), 400 empty reason.
  - `POST users/:id/subscriptions` accepts `access_request_id`; `request_reviewed` outcome → the same 409.
  - Providers for `AccessRequestReviewService`; `users.controller.ts` passes the new `access` query through.
- `apps/admin/src/auth/api-client.ts` (`UserSubscriptionsApi` or a sibling): `listAccessRequests(userId)`, `rejectAccessRequest(userId, requestId, reason)`, `grantAccess` forwards `access_request_id`; `getUsers` forwards `access`; `apps/admin/test/fake-admin-api.ts` stubs.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/user-subscriptions/user-subscriptions.controller.ts`, `.module.ts`, `tokens.ts` | routes |
| MODIFY | `apps/api/src/admin/users/users.controller.ts` | `access` filter |
| CREATE | `apps/api/test/access-request-review.int.spec.ts` | API integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client |

**Testing (API integration, real app):** no cookie → 401, cookie without CSRF header → 403 `CSRF_FAILED`, a **customer or creator Bearer token** → 401; list, reject and grant-with-request happy paths with the exact bodies; reject without a reason → 400 "Alasan wajib diisi."; second reject / reject after approval → 409 with the status and no row change; **IDOR:** another customer's request id under `:id`, a creator id, an admin id, malformed → identical 404; grant with a request of a different creator → 404; grant closes the pending request and the customer's profile shows `ACTIVE` with `last_review` APPROVED; reject makes it show `last_review` REJECTED; the outbox holds `access_request.rejected` with ids only; the admin id in a body is ignored; `GET /v1/admin/users?access=pending` filters and 400s on `access=all`; History lists the three labels.

---

### TASK-142: Admin UI: Langganan banners, dialogs and `/users` chip and filter

`apps/admin/src/users/` (placeholder design from existing components; copy marked in `copy.ts`):

- **Langganan tab** (`AdmUserSubs`, route `/users/:id/subscriptions`): one banner per pending request above the table (creator name, "Uji Coba" / "Perpanjangan", requested time in the admin zone) with **Setujui** (secondary) and **Tolak**. A `useAccessRequests` hook loads and refetches the list. No banner while loading / when empty; a load failure shows a small retry line.
- **Setujui:** opens `GrantAccessDialog` with `lockedCreator` and the default 30 hari; its request now carries `access_request_id` (new optional prop `accessRequestId`). On success the existing grant toast, the banner disappears, the table refetches. A 409 `ACCESS_REQUEST_ALREADY_REVIEWED` closes the dialog, shows a conflict toast ("Permintaan sudah ditinjau") and refetches.
- **Tolak:** `RejectAccessRequestDialog` following `RejectRequestDialog` (required reason, counter, empty message "Alasan wajib diisi.", pending label, failure message, button never wraps); success toast and refetch; 409 as above.
- **`/users`:** a "Permintaan akses" chip in the Pengajuan creator / Langganan area of the row when `pending_access_count > 0` (icon + label), and a "Permintaan akses" filter (Semua / Menunggu) in the toolbar and in the mobile Filter panel, kept in the URL (`access=pending`), reset by Reset Filter. The `View` link and the other columns are unchanged.
- Dialog and banner text are placeholders; add them to Known Gaps.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/detail/subscriptions/AccessRequestBanners.tsx`, `RejectAccessRequestDialog.tsx`, `useAccessRequests.ts` (+ specs) | banners, dialog, hook |
| MODIFY | `apps/admin/src/users/detail/subscriptions/SubscriptionsTab.tsx`, `GrantAccessDialog.tsx`, `AccessDialogsHost.tsx`, `subscriptions.module.css`, `copy.ts` | wiring, prop, styles, copy |
| MODIFY | `apps/admin/src/users/UsersPage.tsx`, `list-url.ts` (+ specs), `useUserList.ts`, `copy.ts` | chip, filter, URL state |
| MODIFY | `visual/specs/visual.spec.ts` | `AdmUserSubs` with a banner (placeholder, informational), `AdmUsers` unchanged region |

**Testing:** banner per request with the right label and time; Setujui opens the grant dialog with the creator fixed and sends `access_request_id`; success removes the banner and refetches; Tolak requires a reason, sends it once (double click acts once), shows sending / failure / conflict states, success removes the banner; 409 refetches; no banner when none; the `/users` chip shows with a count and not without; the filter round-trips the URL, resets, and passes `access=pending`; layout at 1440 / tablet / mobile without wrapping buttons; existing Langganan and `/users` tests still pass; Playwright shows `AdmUserSubs` and `AdmUsers` unchanged outside the added elements.

---

Order: TASK-137 → TASK-138 → TASK-139 → TASK-140 → TASK-141 → TASK-142 (rebuild `contracts`, `db` and `backend-core` before the API and admin see them; run `pnpm db:migrate` on the dev database).
