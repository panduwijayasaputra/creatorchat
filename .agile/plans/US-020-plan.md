# Technical Plan: US-020 — Admin grants, extends and revokes access from user detail

> Task ids 113–119 (108–112 belong to US-019). **UI tasks (TASK-118, 119) depended on US-018 (built meanwhile)** (agreed with the user, 2026-11-16): they replace the "belum dibangun" Langganan placeholder that US-018 leaves at `/users/:id/subscriptions`. TASK-113…117 (contracts, migration, services, API, client) do not need the detail page and can be built now.

## Architecture Overview

Agreed with the user (2026-11-16, all recommended options):

1. **Depend on US-018** for the detail page, header, tabs and breadcrumbs.
2. **Outbox event only, no Telegram message.** Each grant / extend / revoke writes one outbox event (ids and dates only) in the same transaction. No handler is registered, so the US-013 dispatcher (which claims only handled types) leaves it PENDING; Phase E adds the message and its copy. The dialog sentences that mention a notification ("Notifikasi aktivasi dikirim lewat Telegram", "User menerima notifikasi tanggal berakhir baru") are shown **verbatim**; that nothing is sent yet is recorded as a design/behaviour gap.
3. **Admin display zone is fixed `Asia/Jakarta`** (a constant in contracts; Jakarta has no DST, so a +07:00 offset is exact). No schema change; becomes a setting only if admins get a timezone.

Defaults taken (say so if you disagree):
- A **re-grant** (after expiry or revocation) reuses the single `Subscription` row: `starts_at` = now, `ends_at` = new end, `revoked_at` = NULL. Earlier `SubscriptionEvent` rows stay.
- **Grant** is refused when the pair is currently active (409 `SUBSCRIPTION_ACTIVE`, "gunakan Perpanjang").
- **Extend** is allowed on an active **or expired** row (base = the later of `ends_at` and now, as the story says), refused on a revoked row (409 `SUBSCRIPTION_REVOKED`; use Berikan Ulang). The UI only offers Perpanjang on active rows (as designed); the expired case is server-only.
- **Revoke** is allowed on an active row only (409 `SUBSCRIPTION_NOT_ACTIVE` for expired / already revoked).
- **End date rule:** 23:59:59 Jakarta of a calendar date. Grant: today + N days (N ∈ 7 / 30 / 90, default 30) or a custom date (strictly after today, at most 400 days ahead; 400 otherwise). Extend: calendar date of the base + N days (7 / 30 / 90). The server computes the date; the dialog's preview is a display of the same function (shared in contracts).
- A subscription whose `starts_at` is in the future does not occur (grant always starts now); the list treats "not revoked and `ends_at` > now" as Active.
- Double submit: the second request sees the new state and gets 409 with nothing written; the dialog disables its buttons in flight.

```
GET  /v1/admin/users/:id/subscriptions          → SubscriptionListService.list(userId, query)      (table)
GET  /v1/admin/users/:id/grantable-creators      → SubscriptionListService.grantableCreators(userId) (picker)
POST /v1/admin/users/:id/subscriptions           { creator_id, duration_days | end_date, reason }  → SubscriptionAccessService.grant
POST /v1/admin/users/:id/subscriptions/:subId/extend { duration_days, reason }                      → .extend
POST /v1/admin/users/:id/subscriptions/:subId/revoke { reason }                                     → .revoke
```

Brief refs: §2, §5 (a CREATOR cannot be a customer), §6 (account block vs expiry), §11 (user detail: grant / extend / revoke with reason), §13 (`Subscription`, `SubscriptionEvent`, `Conversation`), §15, §17. Design refs: `AdmUserSubs`, `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke`, `AdmUserSubsGranted`, `AdmUserSubsExtended`, `AdmUserSubsRevoked`, `AdmTableStates` (1440×900 boards; compare the table and dialog cards). Route: `/users/:id/subscriptions`.

Out of scope: subscription detail `AdmSubDetail` and the **View** button target (US-021; View is drawn but inert with the US-017 tooltip until then), customer access requests (US-023/024), the chat itself, the entitlement checks on send (Phase C chat stories), the Telegram message (Phase E), the creator-side subscriber list (US-021).

## Authorization & Data Rules

- **Principal:** admin only (`CsrfGuard` + `AdminJwtGuard`; GETs need no CSRF token, writes do). A Telegram user token is 401. The admin id comes from the session (`@CurrentAdmin()`), never the body.
- **Ids:** `:id` is `users.id`, `:subId` a `subscriptions.id`, both UUIDs, otherwise 404. Every subscription query filters `customer_id = :id` in SQL: another user's subscription id under this user → 404, identical to unknown. `creator_id` in the grant body must be an ACTIVE `creators` row (else 409 `CREATOR_NOT_ACTIVE`; unknown / malformed → 404 `NOT_FOUND`). Body schemas are strict (unknown keys stripped, as in US-016), `reason` uses the shared `ReasonSchema` (1–300 code points, empty → 400 "Alasan wajib diisi.").
- **One transaction per action, fixed lock order:** `users` row of the customer (`FOR UPDATE`) → `creators` row (grant only) → `subscriptions` row (`FOR UPDATE`; for a first grant, `INSERT … ON CONFLICT (customer_id, creator_id) DO NOTHING` then lock, so two admins cannot create two rows). This matches the user-first order of approval, moderation and US-019. Re-check inside the lock:
  - grant: customer role USER and status ACTIVE (else 409 `USER_ROLE_CONFLICT` / `USER_STATUS_CONFLICT`; a CREATOR can never be a customer), creator ACTIVE, subscription not active;
  - extend / revoke: the state rules above.
- **Writes (same transaction):** the `subscriptions` row; one `subscription_events` row (`type` GRANT / EXTEND / REVOKE, `subscription_id`, `admin_id`, `reason`, `previous_ends_at`, `new_ends_at`, `starts_at` for GRANT, `created_at`); one `audit_logs` row (`subscription.granted|extended|revoked`, target `subscription:<id>`, with reason, creator id and dates, request id); one `outbox_events` row (`subscription.granted|extended|revoked`, `dedupe_key = subscription_event:<event id>`, payload ids and dates only, **no reason text**); on grant, the conversation: `INSERT INTO conversations … ON CONFLICT (customer_id, creator_id) DO NOTHING`.
- **Revoke never deletes** messages or the conversation; the conversation stays after revoke and expiry.
- **Entitlement is read from `subscriptions`** (`revoked_at IS NULL AND starts_at <= now < ends_at`) by the Phase C checks; the integration tests assert "access inactive immediately after revoke" with that exact predicate (a shared helper `isEntitled(sub, now)` in backend-core that the later chat stories reuse).
- **Events log is append-only**: DB trigger rejects UPDATE / DELETE (same pattern as `audit_logs`).
- **List query** (strict, snake_case; unknown key / value → 400): `q` (trimmed, ≤ 100, creator name, LIKE-escaped, bound), `status` (`all|active|expired|revoked`), `ends` (`all|next7|next30|past`; **placeholder options, Berakhir filter options are not drawn**), `sort` (`creator|status|starts|ends`, default `ends`), `dir` (default `desc`), `page`, `page_size` (10 / 25 / 50). ORDER BY from a fixed map, then `ends_at desc`, then `id`. Item fields: subscription id, `creator` {id, display_name, avatar_url (https or null)}, status ACTIVE / EXPIRED / REVOKED, `starts_at`, `ends_at`, `revoked_at`. Nothing else (no events, no reasons, no chat data). Unknown / non-USER user → 404.
- **Grantable creators:** ACTIVE creators (id, display_name, avatar) not currently active for this user, ordered by name; `no-store`.
- **Privacy:** reasons, names as text only; reason never logged and never in the outbox payload.

## Dependencies

- Prior stories: US-018 (detail page shell, tabs, `usePageCrumbs`, placeholder to replace), US-017 (`/users` list, `USER_LIST_COPY.inertAction`), US-019 (user moderation: status / role conflict codes), US-016 (`useBlockCheck` / dialog + toast host pattern), US-012 (`ConfirmDialog` props, `ReasonSchema`, `OutboxService`), US-014 (list-url, `DataTable`), US-010 (`subscriptions` table), US-002 (`StatusChip`, `Avatar`, `Select`).
- No new packages and no env. One migration: `subscription_events` and `conversations`.
- Next free task ids: 113–119.

## Risks

- **Two admins / double click creating two rows or two events:** unique pair + `ON CONFLICT DO NOTHING` + row lock; concurrency test with parallel grants.
- **Granting to a creator account or a blocked user:** role / status re-checked inside the user-row lock; test.
- **Wrong "now" in the end date:** one pure function (`computeEndDate`) in contracts, tested at the Jakarta midnight boundary (16:59 / 17:01 UTC), used by server and dialog preview.
- **Stale list after an action:** refetch the list after every success; a 409 shows the conflict toast and refetches (the state moved under the admin).
- **Undesigned bits (report as gaps, do not invent final UI):** the Berakhir filter options, conflict / failure toasts and dialog failure banner text, the dialog's creator-picker empty state (no grantable creator), the custom date picker popover, the "Tidak bisa memberi akses" explanation for a blocked user (the Berikan Akses button is disabled with the inert tooltip while the user is BLOCKED), and the notification sentences that promise a message not sent until Phase E. Placeholder copy is marked in `copy.ts`.
- **Detail page not built:** UI tasks are blocked until US-018; do not build a second detail shell.
- **Conversation table is minimal on purpose:** later stories (Phase C chat) extend it (`last_message_at`, read cursors). `mode` defaults to MANUAL; Phase F decides AI defaults.

## Tasks

### TASK-113: Subscription access contracts

`packages/contracts/src/subscription-access.ts` (+ spec, exported):

- `ACCESS_ZONE = 'Asia/Jakarta'`, `ACCESS_DURATIONS = [7, 30, 90] as const`, `DEFAULT_DURATION = 30`, `MAX_END_DAYS = 400`.
- `computeEndDate(now: Date, days: number): Date` (23:59:59 Jakarta of today + days) and `computeExtendedEnd(currentEnd: Date, now: Date, days: number): Date` (calendar date of `max(currentEnd, now)` in Jakarta + days at 23:59:59); `endOfJakartaDay(dateString)` for a custom `YYYY-MM-DD`.
- `GrantAccessSchema`: strict `{ creator_id: uuid, reason: ReasonSchema }` plus exactly one of `duration_days` (allowlist) or `end_date` (`YYYY-MM-DD`); `ExtendAccessSchema` `{ duration_days, reason }`; `RevokeAccessSchema` `{ reason }`. A refinement refuses both or neither of `duration_days` / `end_date`.
- `SubscriptionListQuerySchema` (strict, defaults, allowlists above; `SUBSCRIPTION_SORT_FIELDS`, `SUBSCRIPTION_STATUSES`, `SUBSCRIPTION_END_FILTERS`), `SubscriptionRowSchema`, `SubscriptionListResponseSchema { items, total, page, page_size }`, `GrantableCreatorsResponseSchema`.
- `SubscriptionActionResponseSchema { subscription: { id, creator_id, status, starts_at, ends_at, revoked_at } }`.
- Error codes (with the existing codes enum): `SUBSCRIPTION_ACTIVE`, `SUBSCRIPTION_REVOKED`, `SUBSCRIPTION_NOT_ACTIVE`, `CREATOR_NOT_ACTIVE` (all 409; `details.status` where useful), reusing `USER_ROLE_CONFLICT` / `USER_STATUS_CONFLICT`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/subscription-access.ts`, `subscription-access.spec.ts` | schemas, date helpers, allowlists |
| MODIFY | `packages/contracts/src/index.ts`, `errors.ts` | export, new codes |

**Testing:** defaults; every allowlist refuses unknown values (status, sort, dir, ends, page size, page, extra key, repeated key); grant needs exactly one of duration / end_date; duration outside 7/30/90 refused; empty / whitespace / over-300 reason refused; strict (a leaked `admin_id`, `customer_id`, `starts_at` key is stripped or refused as in US-016); `computeEndDate` at the Jakarta midnight boundary (16:59:59Z vs 17:00:00Z), month and year rollover; `computeExtendedEnd` for a future end, a past end (base = now) and an end exactly now; a custom date of today / in the past / beyond 400 days refused.

---

### TASK-114: Migration: `subscription_events` and `conversations`

`packages/db/prisma/schema.prisma` + new migration `20261122010000_subscription_events_conversations`:

- `SubscriptionEvent` → `subscription_events`: `id` uuid, `subscription_id` FK → subscriptions (RESTRICT), `type` enum `SubscriptionEventType` (GRANT, EXTEND, REVOKE), `admin_id` FK → admin_accounts (RESTRICT), `reason` text, `audit_log_id` uuid null (the audit row written in the same transaction; added for US-021's event → log link, plain column, no FK because `audit_logs` is polymorphic), `previous_ends_at` timestamptz(3) null, `new_ends_at` timestamptz(3) null, `starts_at` timestamptz(3) null (GRANT only), `created_at`. CHECK: `char_length(reason) BETWEEN 1 AND 300`. Index `(subscription_id, created_at, id)`. Append-only trigger (same function pattern as `audit_logs_append_only`).
- `Conversation` → `conversations`: `id` uuid, `customer_id` FK → users (RESTRICT), `creator_id` FK → creators (RESTRICT), `mode` enum `ConversationMode` (AI, MANUAL; default MANUAL), `response_version` int default 0, `created_at`, `updated_at`; UNIQUE `(customer_id, creator_id)`; index `(creator_id)`.
- Index on `subscriptions (creator_id, ends_at)` (brief §13 query path) and `(customer_id, ends_at)` for the list.
- Seed: events for the two seeded subscriptions (Raka → Salsa active until 27 Nov 2026, plus an expired Raka → Kirana ending 6 Nov 2026 to match `AdmUserSubs`), and conversations for both pairs. Idempotent (the seed already upserts).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | models, enums, indexes |
| CREATE | `packages/db/prisma/migrations/20261122010000_subscription_events_conversations/migration.sql` | tables, CHECKs, trigger |
| MODIFY | `packages/db/prisma/seed.ts` (path per repo) | fixtures |

**Testing (db integration):** migration applies on the test DB; the events trigger rejects UPDATE and DELETE; reason CHECK rejects empty / over-long; a second `(customer, creator)` conversation is refused; deleting a referenced subscription / admin / user / creator is refused (RESTRICT); seed twice leaves one row per pair. Never `migrate reset` a database you did not create; run only against the dev / test DBs.

---

### TASK-115: `SubscriptionAccessService` (backend-core)

`packages/backend-core/src/subscription-access/`:

```ts
interface AccessContext { adminId: string; reason: string; requestId?: string }
class SubscriptionAccessService {
  constructor(prisma: PrismaClient, outbox: OutboxService, clock?: () => Date)
  grant(userId: string, input: { creatorId: string; durationDays?: number; endDate?: string }, ctx: AccessContext): Promise<GrantOutcome>
  extend(userId: string, subId: string, input: { durationDays: number }, ctx: AccessContext): Promise<ExtendOutcome>
  revoke(userId: string, subId: string, ctx: AccessContext): Promise<RevokeOutcome>
}
// Outcome: { kind:'ok', subscription } | { kind:'not_found' } | { kind:'conflict', code, details? } | { kind:'invalid', message }
export function isEntitled(sub: { startsAt: Date; endsAt: Date; revokedAt: Date | null }, now: Date): boolean
```

- Transaction and lock order as in "Authorization & Data Rules"; ids validated as UUIDs (malformed → `not_found`); `now` read once from the clock inside the transaction and used for both the rule checks and the stored dates.
- Every action writes the audit row first and stores its id in the event's `audit_log_id` (US-021 links to it). Grant: refuse non-USER / BLOCKED customer, non-ACTIVE or unknown creator; `INSERT … ON CONFLICT DO NOTHING`, lock, refuse if active; set `starts_at = now`, `ends_at`, `revoked_at = NULL`; event GRANT; conversation `ON CONFLICT DO NOTHING`; audit; outbox. End date must be after now and ≤ 400 days (`invalid` → 400).
- Extend: ownership in SQL (`customer_id = userId`); refuse revoked; new end from `computeExtendedEnd`; `revoked_at` untouched; event EXTEND with previous and new end.
- Revoke: refuse non-active; `revoked_at = now` (`ends_at` kept so the row shows the original end, as `AdmUserSubsRevoked`); event REVOKE.
- Never touches messages, conversations (beyond the grant insert) or other subscriptions.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/subscription-access/subscription-access.service.ts`, `entitlement.ts`, `index.ts` | service and helper |
| CREATE | `packages/backend-core/src/subscription-access/subscription-access.service.int.spec.ts`, `entitlement.spec.ts` | tests |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL, injected clock):**
- grant → row created, `isEntitled` true, event GRANT with reason and admin, audit row with reason, outbox row (no reason in payload), conversation created once;
- grant to a second creator for the same user works; grant again while active → conflict `SUBSCRIPTION_ACTIVE`, nothing written (event count unchanged);
- extend moves `ends_at` by the chosen days from the old end; on an expired row from now; on a revoked row → conflict; event carries previous and new end;
- revoke → `isEntitled` false at the same instant; conversation and messages untouched; revoke twice → second conflict, one REVOKE event;
- re-grant after expiry and after revoke reuses the same row id, clears `revoked_at`, keeps earlier events (count grows, none changed);
- grant to a CREATOR account, a BLOCKED user, a BLOCKED creator, an unknown creator → refused, no rows written;
- **IDOR:** another user's `subId` under this user → `not_found` for extend and revoke; a creator id or admin id as `userId` → `not_found`;
- invalid end dates (today, past, > 400 days) → `invalid`, nothing written;
- **concurrency:** two parallel grants for one pair → exactly one succeeds (one event, one row, one conversation); parallel extend + revoke → serialised, final state consistent with exactly the events written;
- a failing step (forced error after the event insert) rolls everything back.

---

### TASK-116: `SubscriptionListService` (list and grantable creators)

`packages/backend-core/src/subscription-list/`:

```ts
class SubscriptionListService {
  constructor(prisma: PrismaClient, clock?: () => Date)
  list(userId: string, query: SubscriptionListQuery): Promise<SubscriptionListResponse | null>   // null = unknown or non-USER
  grantableCreators(userId: string): Promise<GrantableCreatorsResponse | null>
}
```

One SQL projection joined to the creator's name and avatar; status computed in SQL from `revoked_at` / `ends_at` against `now`; `q` LIKE-escaped and bound; ORDER BY from a fixed map; `total` independent of the page; the `ends` filter uses the same `now`. Only the allowlisted columns are selected.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/subscription-list/subscription-list.service.ts`, `index.ts`, `.int.spec.ts` | list service |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration):** one user with active, expired and revoked rows plus another user's rows: only this user's rows are returned; status derivation at the boundary (`ends_at` = now → expired); status / ends filters; `q` case-insensitive with `% _ \` literal; sort fields both ways with stable ties; pages disjoint, `total` independent, a page past the end empty; `grantableCreators` excludes active pairs and BLOCKED creators but includes expired / revoked pairs; unknown user, malformed id, creator id, admin id → null; result keys equal the contract (no event, reason, session or chat fields).

---

### TASK-117: API endpoints and admin client

- `apps/api/src/admin/user-subscriptions/` (module imports `AdminAuthModule`, thin controller under `@UseGuards(CsrfGuard, AdminJwtGuard)`): the five routes above; queries and bodies through `ZodValidationPipe`; outcomes mapped to `AppError` (`not_found` → 404 `NOT_FOUND` with one generic message, `conflict` → 409 with the code and `details`, `invalid` → 400 `VALIDATION_FAILED`). Writes return 201 (grant) / 200 (extend, revoke) with `SubscriptionActionResponse`; everything `no-store`. Providers in `tokens.ts` / module.
- `apps/admin/src/auth/api-client.ts`: `listUserSubscriptions(id, query, signal?)`, `getGrantableCreators(id, signal?)`, `grantAccess(id, body)`, `extendAccess(id, subId, body)`, `revokeAccess(id, subId, body)`; same helper pattern (defaults omitted, ids encoded, response validation, one renewal retry, abort); `fake-admin-api.ts` stubs.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/admin/user-subscriptions/user-subscriptions.controller.ts`, `user-subscriptions.module.ts`, `tokens.ts` | routes |
| MODIFY | `apps/api/src/admin/admin.module.ts` | register the module |
| CREATE | `apps/api/test/admin-user-subscriptions.int.spec.ts` | API integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client calls |

**Testing (API integration, real app):** no session and a Telegram user Bearer token → 401 on all five routes; a write without the CSRF token → 403; grant → 201, list shows Active, grant again → 409 `SUBSCRIPTION_ACTIVE`; extend → new `ends_at`; revoke → status Dicabut; re-grant works and old events remain; grant to a CREATOR / BLOCKED user → 409; blocked creator → 409; empty reason → 400 "Alasan wajib diisi." on all three writes; another user's `subId` → 404 (same body as unknown); list 400 on every unknown sort / status / ends / page size / key; **no admin ids, reasons, session or chat data** in any response body; audit + event rows carry the reason; a double submit (two parallel POSTs) leaves one event. Client: URL building, validation, renewal, abort.

---

### TASK-118: Langganan tab (table, filters, states) — blocked until US-018

`apps/admin/src/users/detail/subscriptions/` replacing the placeholder on `/users/:id/subscriptions` (board `AdmUserSubs`, PNG + HTML; state boards `AdmTableStates` for loading / empty / filtered-empty / error):

- Toolbar: search "Cari creator", `Status: Semua` and `Berakhir: Semua` selects, **Reset Filter**, **+ Berikan Akses** (primary; disabled with the inert tooltip while the user is BLOCKED).
- Table: Creator (avatar + name), Status (`StatusChip`: Active / Kedaluwarsa / Dicabut, icon + label), Mulai, Berakhir, Aksi. Sortable headers, pagination 10 / 25 / 50, "Menampilkan 1–2 dari 2 hasil", URL-synced view state (pattern from `/users`). Dates through the shared `formatDate` (Jakarta, "27 Nov 2026"). Buttons never wrap.
- Row actions: Active → **View** (inert until US-021, tooltip), **Perpanjang**, **Cabut** (red); Kedaluwarsa / Dicabut → **View**, **Berikan Ulang**. Perpanjang / Cabut / Berikan Ulang open the dialogs of TASK-119.
- Payment note card: "Tidak ada transaksi pembayaran. Admin memberikan, memperpanjang, atau mencabut akses dengan alasan, dan setiap tindakan dicatat di audit log."
- Race-safe loading (abort previous request), error state with retry; text only for names.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/detail/subscriptions/SubscriptionsTab.tsx`, `useSubscriptions.ts`, `subscriptions-url.ts`, `subscriptions.module.css` | tab |
| MODIFY | `apps/admin/src/users/detail/UserDetailPage.tsx` (routes), `apps/admin/src/app/routes.tsx`, `apps/admin/src/users/copy.ts` | wire tab, board copy (placeholders flagged) |
| CREATE | `apps/admin/src/users/detail/subscriptions/SubscriptionsTab.spec.tsx` | component tests |

**Testing:** renders rows and the right action buttons per status; search / filters / sort / paging change the request and the URL; Reset Filter clears; loading, empty, filtered-empty and error states; Block-state disables Berikan Akses; text is rendered as text (a name with `<script>` is inert).

---

### TASK-119: Grant / Extend / Revoke dialogs, toasts and visual check — blocked until US-018

`apps/admin/src/users/detail/subscriptions/`:

- `GrantAccessDialog` (`AdmDlgGrant`): identity card (avatar, name, `@username · ID`), **Creator** select (from `grantable-creators`; preselected and locked for **Berikan Ulang**), **Durasi** select (7 / 30 / 90 hari, default 30 hari) with a "Tanggal khusus" choice that turns "Tanggal berakhir" into a date input, computed "Tanggal berakhir" (`14 Des 2026, 23.59 WIB`, via `computeEndDate`) with the hint "Dihitung dari hari ini. Bisa diganti dengan tanggal khusus.", required **Alasan (wajib)** textarea with "Alasan dicatat di audit log." and the verbatim body sentence; buttons Batal / Berikan Akses.
- `ExtendAccessDialog` (`AdmDlgExtend`): card "Raka Putra → Salsa Maheswari / Akses aktif hingga 27 Nov 2026" + Active chip, **Tambah durasi** select, read-only **Berakhir menjadi** (via `computeExtendedEnd`), reason, verbatim sentence; Batal / Perpanjang Akses.
- `RevokeAccessDialog` (`AdmDlgRevoke`): the same card, the sentence "Akses berakhir **sekarang**. User tidak bisa mengirim pesan baru ke creator ini. Riwayat chat yang sudah diterima tetap bisa dibuka.", **Alasan pencabutan (wajib)**; destructive Batal / Cabut Akses.
- Built on `ConfirmDialog` (`confirmDisabled`, `pendingLabel`, `onConfirm → false` keeps the dialog open with the reason kept on error, required-reason message "Alasan wajib diisi.").
- Toasts (`AdmUserSubsGranted|Extended|Revoked`): "Akses {user} ke {creator} diberikan hingga {date}" / "diperpanjang hingga {date}" / "dicabut"; after success: close, refetch the list, toast. A 409 closes the dialog with the conflict toast and refetches (**placeholder copy**); a network / 5xx error keeps the dialog open with a failure banner (**placeholder copy**); creator picker empty state "Tidak ada creator yang bisa diberi akses" (**placeholder**).
- Playwright screenshots at 1440×900 of `AdmUserSubs`, `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke`, `AdmUserSubsGranted|Extended|Revoked` compared against the PNGs (dialog cards and toast, as US-016 did).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/detail/subscriptions/GrantAccessDialog.tsx`, `ExtendAccessDialog.tsx`, `RevokeAccessDialog.tsx`, `access-dialogs.module.css` | dialogs |
| MODIFY | `apps/admin/src/users/detail/subscriptions/SubscriptionsTab.tsx` | wire dialogs and toasts |
| MODIFY | `apps/admin/src/users/copy.ts`, `apps/admin/src/preview/Preview.tsx`, `Preview.spec.tsx` | copy, `/__preview` entries |
| CREATE | `apps/admin/src/users/detail/subscriptions/access-dialogs.spec.tsx` | component tests |
| MODIFY | `visual/` boards list | add the seven boards |
| MODIFY | `.agile/guidelines/design-integration.md`, `codebase-map.md` | record gaps, built state |

**Testing:** end date preview matches `computeEndDate` and updates with the duration / custom date; empty reason shows the message, keeps the dialog and the typed text; double click sends once (buttons disabled in flight); a 409 closes with the conflict toast and refetches; a failure keeps the dialog open; the Berikan Ulang dialog locks the creator; success toasts show the right names and dates; `pnpm visual` for the seven boards within the usual tolerance.

---
