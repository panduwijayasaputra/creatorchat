# Technical Plan: US-023 — Customer requests trial or renewal access

> Task ids 133–136 (127–132 belong to US-022). Builds on US-022 (`access_requests` table and its partial unique index, `accessStateOf`, `CreatorAccessService`, `/creators/:publicCode`), US-020 (`subscriptions`, `isEntitled`) and US-012/013 (outbox write side). The admin review (approve / reject, which writes `reviewed_*` and grants access) is US-024; the customer Langganan page and the chat screens (US-025 / US-026) add their own request buttons later.

## Architecture Overview

Agreed with the user (2026-11-17, recommended options):

1. **Profile page only.** "Minta Akses Uji Coba" (`CreatorGuest`) and "Minta Perpanjangan Akses" (`CreatorExpired`) on `/creators/:publicCode` call the new endpoint. `ChatExpired` and `Subscriptions` reuse the same endpoint in US-025 / US-026. No placeholder screens are built here.
2. **`last_review` on the by-code answer.** Optional `{status: 'APPROVED' | 'REJECTED', reviewed_at}` from the viewer's latest *reviewed* request for that creator. No reason, no admin id. No "seen" flag, no migration.

```
POST /v1/creators/by-code/:publicCode/access-requests   @Roles('USER')
   → AccessRequestService.submit(userId, code)
GET  /v1/creators/by-code/:publicCode                   (US-022) + last_review

/creators/:publicCode  CreatorGuest | CreatorExpired → button → submit → refetch → CreatorPending
                       StatesAccess cards (approved / rejected + "Ajukan Lagi")
```

- **The server decides the type.** Inside the transaction the caller's subscription and pending request are read and passed through `accessStateOf(…, now)`: GUEST → `TRIAL`; EXPIRED (including revoked) → `RENEWAL`; PENDING → return the existing request (idempotent); ACTIVE → 409 `ACCESS_ALREADY_ACTIVE`. The request carries no type, no creator id, no user id; the public code only chooses the target.
- **One PENDING per pair, by the database.** Insert with `ON CONFLICT (customer_id, creator_id) WHERE status = 'PENDING' DO NOTHING`; when nothing was inserted, read and return the existing PENDING row (200). A first insert answers 201. A repeat tap, a retry after a lost response and two tabs all end with one row.
- **Locks:** customer user row `FOR UPDATE` first (re-check ACTIVE + role USER), then the creator row `FOR SHARE`/`UPDATE` (re-check ACTIVE and account ACTIVE), consistent with the US-020 order (customer → creator). Serialises with a concurrent grant or block.
- **Outbox:** each *new* request writes one event `access_request.created`, `aggregate_type = 'access_request'`, `aggregate_id = <id>`, payload `{access_request_id, creator_id, customer_id, type}` (ids and enum only), `dedupe_key = access_request:<id>:created`. Status stays PENDING: no consumer until US-024 / Phase E (the dispatcher only claims handled types). A returned existing request writes nothing. Audit: `access.request.created` (actor = the customer, target = the request; metadata type and creator id).
- **Re-ask after rejection ("Ajukan Lagi")** is the same call: the REJECTED row stays, a new PENDING row is inserted (history kept). After EXPIRED + REJECTED renewal the type is RENEWAL again.
- **`last_review`:** `CreatorAccessService.profile` adds one query for the viewer's latest request for that creator with `status <> 'PENDING'` (ordered by `reviewed_at desc, id`). The client shows:
  - **Rejected card** ("Permintaan belum bisa disetujui", "Ditinjau <tanggal>", button "Ajukan Lagi") when the state is GUEST or EXPIRED and `last_review.status = REJECTED`.
  - **Approved card** ("Akses disetujui", "Berlaku hingga …", button "Buka Chat") when the state is ACTIVE and `last_review.status = APPROVED`.
  - Nothing when the state is PENDING (precedence of US-022) or no review exists.
- **"Buka Chat"** on the approved card is the same placeholder toast as `CreatorActive` until US-026 / US-027.
- Dates use the viewer's account time zone (`formatDateTime`), as in US-022.

Brief refs: §6 (trial / renewal, no checkout), §13 (`AccessRequest`), §17. Design refs: `CreatorGuest` (390×1590), `CreatorPending` (390×1650), `CreatorExpired` (390×1670), `StatesAccess` (the "Permintaan disetujui" and "Permintaan ditolak" panels; the third panel, "Chat · riwayat loading", is US-026). No price, payment or checkout element anywhere.

Out of scope: admin queue / review and the grant on approval (US-024), notifications to admin or the customer (Phase E), `Subscriptions` and `ChatExpired` buttons (US-025 / US-026), cancelling a pending request (not in the story or the boards).

## Authorization & Data Rules

- **Principal:** `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('USER')`. CREATOR → 403 `FORBIDDEN_ROLE`; blocked / stale / admin token or none → 401. `Cache-Control: no-store`.
- **Scoping:** the customer id comes only from the session. The body is empty (any body is ignored; unknown keys never reach the service). The target is the public code from the route; unknown, malformed, blocked and inactive creators all give the identical 404 `CREATOR_NOT_FOUND` (same resolver as the profile route), and nothing is written.
- **What the answer reveals:** `{request: {id? no}}` — only `{request_type, requested_at}` plus the new `access` union (always `PENDING` on success). No ids, no creator or admin data.
- **Entitlement:** ACTIVE (not revoked, `starts_at <= now < ends_at`) → 409; the rule is `accessStateOf` / `isEntitled`, never recomputed.
- **Retry / duplicate:** deterministic by the partial unique index; no client key needed.
- **Events:** outbox only (above); no sockets or queues.
- **Rate limit:** none beyond the one-pending rule (it caps rows at one per pair until reviewed). A rejected + immediate re-ask loop is bounded by admin review, noted as a risk.

## Dependencies

- Prior stories: US-022 (table, state function, profile page and `PROFILE_COPY`), US-020 (subscriptions), US-012 (`OutboxService`), US-002 (`BottomToast`, buttons).
- No packages, no env, **no migration**. New error code `ACCESS_ALREADY_ACTIVE` in `ErrorCode`. Seed: Raka Putra → Dinda stays pending; no seed change (rejected / approved cards are tested with inserted rows; US-024 may add fixtures).
- Next free task ids after this plan: 137.

## Risks

- **Race between submit and a grant / block:** the lock order (customer, then creator) matches US-020; tests run two concurrent submits and a submit during a grant.
- **Stale approved card:** the approved card keys off "latest reviewed request is APPROVED and access is ACTIVE", so an admin grant made later from user detail (US-020) can still show it. Acceptable: the copy is true (access is active). US-024's approval grants in the same transaction.
- **Pending row alive while an admin grants directly (US-020):** the customer is ACTIVE, so profile precedence hides it, but the row stays PENDING. US-024 must close such requests; recorded for that story.
- **Re-ask spam after rejection:** one PENDING at a time, each decision is an admin action; no throttle in this story.
- **Undesigned copy (placeholders, mark in `copy.ts`):** the error banner / toast for a failed request, the "already active" message (refreshes the profile instead), the sending label. Everything else is verbatim from the boards.
- **Real Telegram untested:** only the API and the browser are exercised.

## Tasks

### TASK-133: Access request contracts

`packages/contracts/src/creator-access.ts` (+ spec), extends `error-codes`:

- `SubmitAccessRequestResponseSchema` (strict): `{ request_type: 'TRIAL' | 'RENEWAL', requested_at: ISO string }`.
- `CreatorAccessReviewSchema` (strict): `{ status: 'APPROVED' | 'REJECTED', reviewed_at: ISO string }`; `CreatorProfileResponseSchema` gains optional `last_review` (still strict: no reason, admin or id keys).
- `ErrorCode.ACCESS_ALREADY_ACTIVE`; `accessRequestPath(code) = /v1/creators/by-code/${code}/access-requests`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/creator-access.ts`, `creator-access.spec.ts`, `creator-link.ts`, `creator-link.spec.ts` | response + `last_review` |
| MODIFY | `packages/contracts/src/errors.ts` (and its spec) | `ACCESS_ALREADY_ACTIVE` |

**Testing:** each schema accepts its exact shape; refuses a leaked key (`id`, `creator_id`, `review_reason`, `reviewed_by`, `status` on the submit answer), a bad enum, a non-ISO date; `last_review` optional; existing US-022 contract tests still pass.

---

### TASK-134: `AccessRequestService` and `last_review`

`packages/backend-core/src/creator-access/access-request.service.ts` (+ export):

```ts
class AccessRequestService {
  constructor(prisma: PrismaClient, outbox: OutboxService, clock?: () => Date)
  submit(userId: string, code: string): Promise<
    | { kind: 'created' | 'existing'; type: 'TRIAL' | 'RENEWAL'; requestedAt: Date }
    | { kind: 'not_found' }
    | { kind: 'already_active' }
    | { kind: 'not_eligible' }   // account no longer an ACTIVE USER
  >
}
```

One transaction: lock customer row (ACTIVE + USER, else `not_eligible`), resolve the creator by code (ACTIVE creator + account, else `not_found`) and lock it, read the viewer's subscription and pending request, `now` once, `accessStateOf` → map as in the rules, insert with `ON CONFLICT … WHERE status = 'PENDING' DO NOTHING RETURNING`, on empty return read the existing PENDING; audit + outbox only on a real insert.

`CreatorAccessService.profile` returns `lastReview: { status, reviewedAt } | null` (one extra query, `customer_id = userId` in the WHERE, newest reviewed first).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-access/access-request.service.ts`, `access-request.service.int.spec.ts` | submit |
| MODIFY | `packages/backend-core/src/creator-access/creator-access.service.ts`, its int spec, `index.ts` | `lastReview` |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | event type constant `access_request.created` |

**Testing (integration, real PostgreSQL, injected clock):**
- GUEST → TRIAL created; EXPIRED and revoked → RENEWAL created; PENDING → `existing` (same row, no second audit / outbox row); ACTIVE → `already_active`, nothing written; one second past `ends_at` → RENEWAL, one second before → `already_active`.
- Rejected / approved earlier row kept and a new PENDING inserted; the history has two rows.
- **Concurrency:** two parallel submits → one row, one outbox event, both succeed (`created` + `existing`); submit racing a grant ends consistently (either ACTIVE refusal or a pending row, never a pending row for a creator that was blocked first).
- Blocked / unknown / malformed code and a BLOCKED creator account → `not_found`, no rows; blocked customer, CREATOR role → `not_eligible`.
- Another customer's pending request never affects the result; outbox payload holds ids and enum only; `last_review` returns only the viewer's latest reviewed row, never a PENDING one, no reason.

---

### TASK-135: API endpoint and Mini App client

- `apps/api/src/modules/creators/creators.controller.ts`: `POST by-code/:publicCode/access-requests` (`@Roles('USER')`, `no-store`, 201 when `created`, 200 when `existing`, 404 `CREATOR_NOT_FOUND`, 409 `ACCESS_ALREADY_ACTIVE`, 401 for `not_eligible`); `by-code` adds `last_review` (ISO date). Provider for `AccessRequestService` in `creators.module.ts` / `tokens.ts` (needs `OutboxService`).
- `apps/miniapp/src/auth/api-client.ts`: `requestAccess(code, signal?)` with response validation, the existing 401 handling and a typed `ACCESS_ALREADY_ACTIVE`; `getCreatorByCode` validates `last_review`; `fake-miniapp-api.ts` stubs.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | route, provider |
| CREATE | `apps/api/test/access-request.int.spec.ts` | API integration test |
| MODIFY | `apps/api/test/explore.int.spec.ts` / `creator-link.int.spec.ts` | `last_review` shape, roles-declared |
| MODIFY | `apps/miniapp/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/miniapp/test/fake-miniapp-api.ts` | client |

**Testing (API integration, real app):** USER → 201 then 200 on repeat with the same `requested_at`; **CREATOR → 403 `FORBIDDEN_ROLE`; blocked account, admin token, no token → 401**; ACTIVE → 409; blocked / unknown / malformed code → identical 404 and no rows; a body with `user_id`, `type`, `creator_id`, `status` is ignored (row has the session's user and the server's type); IDOR: another customer's pending request is untouched and invisible; type derived (guest vs expired vs revoked); one outbox event per new request; no ids / reason / admin data in any body; client: URL, validation, 401, 409 mapping, abort.

---

### TASK-136: Mini App request flow and result cards

`apps/miniapp/src/creator-link/` (`CreatorLinkPage.tsx`, `CreatorProfileView.tsx`, `profile-copy.ts`, css):

- "Minta Akses Uji Coba" / "Minta Perpanjangan Akses" call `requestAccess`; disabled with a sending label while in flight (never wraps); on 200/201 refetch the profile and show `CreatorPending` with the stored "Dikirim <tanggal>"; on 409 `ACCESS_ALREADY_ACTIVE` refetch (shows `CreatorActive`); on network / server error show the placeholder error message through `BottomToast`/inline, button enabled for retry, nothing marked sent; 401 follows the existing session handling.
- `StatesAccess` cards: rejected card + "Ajukan Lagi" (same call) in GUEST / EXPIRED with `last_review.status = REJECTED`; approved card + "Buka Chat" (placeholder toast until US-026) in ACTIVE with `last_review.status = APPROVED`. Copy verbatim from `StatesAccess`; "Berlaku hingga" uses `ends_at`, "Ditinjau" uses `reviewed_at`, both in the viewer's zone.
- Remove the US-022 placeholder toast from the two request buttons only (Buka Chat, Lihat Riwayat Chat stay placeholders). No price, payment or checkout text.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/creator-link/CreatorLinkPage.tsx`, `CreatorProfileView.tsx`, `profile-copy.ts`, `profile.module.css` | flow, cards |
| MODIFY | `apps/miniapp/src/creator-link/creator-link.spec.tsx`, `creator-profile.spec.tsx` | component tests |
| MODIFY | `visual/` specs | screenshots of `StatesAccess` approved / rejected panels and the four profile boards at 390 px |

**Testing:** guest tap → request sent once (double tap does not send twice), disabled while sending, then `CreatorPending` with the date; expired / revoked → renewal; rejected card → "Ajukan Lagi" → pending; approved card in ACTIVE; no card when pending; failure keeps the profile, shows the error and the button works again; 409 refreshes to active; dates in `Asia/Jakarta` vs `Australia/Sydney`; buttons never wrap at 390 px; no price / payment / checkout words in any state; Playwright screenshots match `CreatorGuest`, `CreatorPending`, `CreatorExpired` and the two `StatesAccess` panels.

---

Order: TASK-133 → TASK-134 → TASK-135 → TASK-136 (rebuild `contracts` and `backend-core` before the API and Mini App see them; no `pnpm db:migrate` needed).
