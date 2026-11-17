# Technical Plan: US-021 — Admin subscription detail and creator Subscriber tab

> Task ids 120–126 (113–119 belong to US-020). **Depends on US-020, US-015 and US-018 being built first** (agreed with the user, 2026-11-16): this plan reuses US-020's `subscription_events` + `conversations` migration, `SubscriptionAccessService`, contracts (`SUBSCRIPTION_STATUSES`, `SUBSCRIPTION_END_FILTERS`, `computeEndDate`, grant / extend / revoke bodies), endpoints and the Grant / Extend / Revoke dialogs; US-015's creator detail page (Subscriber tab placeholder, header, `HistoryTab` pattern, `/logs/:id`); US-018's user detail page and `usePageCrumbs`. **US-020 amendment made with this plan:** `subscription_events` gets a nullable `audit_log_id` (written in the same transaction as the audit row) so an event can link to its log entry.

## Architecture Overview

Agreed with the user (2026-11-16, all recommended options):

1. **Event View → the audit entry.** Each event row's View opens `/logs/:id` (US-015 Detail Log) through the event's `audit_log_id`. An old event without one (none exist once US-020 is built) shows View disabled.
2. **User picker for Berikan Akses on the creator side:** `AdmDlgGrant` only has a Creator picker. The user-picker variant has no board, so it is built as a **flagged placeholder** (same dialog card, the Creator select replaced by a searchable user list) and recorded in Known Gaps.
3. **One entitlement rule for every count:** a shared SQL predicate (not revoked, `starts_at <= now < ends_at`, customer ACTIVE and role USER, creator row ACTIVE and creator account ACTIVE). The creator list / detail subscriber counts and the user list / detail active-subscription counts are refactored onto it, with a consistency test. A blocked creator now shows **0** active subscribers, as `AdmCrBlocked` does.

```
GET /v1/admin/users/:id/subscriptions/:subId          → SubscriptionDetailService.get(userId, subId)         (AdmSubDetail card)
GET /v1/admin/users/:id/subscriptions/:subId/events   → SubscriptionDetailService.events(userId, subId, q)   ("Riwayat akses")
GET /v1/admin/creators/:id/subscribers?…              → CreatorSubscribersService.list(creatorId, query)     (AdmCrSubs table)
GET /v1/admin/creators/:id/grantable-users?q=         → CreatorSubscribersService.grantableUsers(creatorId, q) (picker)
writes: US-020 endpoints (POST /v1/admin/users/:id/subscriptions[/:subId/extend|revoke]), unchanged

/users/:id/subscriptions/:subId   AdmSubDetail     (Perpanjang / Cabut Akses → US-020 dialogs, "Kembali ke Langganan")
/creators/:id/subscribers         AdmCrSubs        (View → user detail, Perpanjang / Cabut / Berikan Ulang, Berikan Akses)
```

- **Subscription detail** (`AdmSubDetail`, title "Langganan: Raka Putra → Salsa Maheswari"): Status chip (Active / Kedaluwarsa / Dicabut), Mulai, Berakhir (`27 Nov 2026, 23.59 WIB`), Sumber "Diberikan admin" (constant: access is only ever given by an admin), **Dibuat oleh** (the admin of the latest GRANT event), Pembayaran "Tidak ada transaksi" (constant); **Perpanjang** and **Cabut Akses** on an Active subscription, **Berikan Ulang** on an expired or revoked one (the US-020 dialogs). "Riwayat akses": a server-side table of the subscription's events (Waktu, Aktor, Tindakan "Berikan akses / Perpanjang akses / Cabut akses", Ringkasan e.g. "30 hari", Status Berhasil, View), read-only, with pagination 10 / 25 / 50. **Kembali ke Langganan** returns to the list URL the admin came from (router state), else `/users/:id/subscriptions`.
- **Subscriber tab** (`AdmCrSubs`) replaces the US-015 placeholder for creator accounts: toolbar "Cari nama atau Telegram ID", Status akses and Berakhir filters, Reset Filter, **Berikan Akses**; table Subscriber (avatar, name), Telegram (`@username` over `ID …`), Status akses, Mulai, Berakhir, Aksi (View → `/users/:customerId`, Perpanjang / Cabut on Active rows, Berikan Ulang on expired / revoked). Row actions call the US-020 user-scoped endpoints with the row's customer id and subscription id, so no new write endpoints. A **pending request** (kind `request`) has no subscribers: the tab shows the table's empty state without calling the API.
- **Counts:** `entitledSubscriptionSql` (TASK-121) is the only place the rule lives for read-side counts; the write-side `isEntitled(sub, now)` of US-020 mirrors it (same predicate, tested against each other). The creator list's "Langganan aktif" mark on a *request* row keeps its separate **blocking rule** (active or future, not revoked) because it answers "can this applicant be approved", not "is access active".

Brief refs: §11 (Creator detail subscriber table with grant / extend / revoke and View user; user detail View subscription; "Semua tabel"), §13 (`SubscriptionEvent` append-only), §6, §15. Design refs: `AdmSubDetail` (1440×760), `AdmCrSubs` (1440×1300), `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke`, `AdmTableStates`. Routes: `/users/:id/subscriptions/:subId`, `/creators/:id/subscribers`.

Out of scope: access requests (US-023/024), the customer Langganan page (US-025), Telegram messages (Phase E), the chat, a creator-side "Hapus"/delete of anything (events are read-only).

## Authorization & Data Rules

- **Principal:** admin only (`CsrfGuard` + `AdminJwtGuard`; the four new routes are GET, no CSRF token needed; a Telegram user token is 401). `Cache-Control: no-store`. Read-only: nothing here writes (not even an audit row for reading).
- **Ids:** every id is a UUID, otherwise 404. `GET /users/:id/subscriptions/:subId[/events]`: `:id` must be a USER and the subscription must have `customer_id = :id` **in the SQL** (another user's subscription id, a creator id, an admin id, unknown and malformed ids are one identical 404). `GET /creators/:id/subscribers` and `grantable-users`: `:id` is a **creator id only** (a pending application id, user id, unknown and malformed ids are 404; the US-015 resolver is not used here because only creators have subscribers).
- **Detail fields:** subscription `id`, `status` (ACTIVE: not revoked and `ends_at` > now; REVOKED: `revoked_at` set; else EXPIRED, the US-020 derivation), `starts_at`, `ends_at`, `revoked_at`, `source` ('ADMIN', constant), `created_by_label` (admin **username** of the latest GRANT event, never the admin id), `customer` {id, display_name, telegram_username, telegram_id}, `creator` {id, display_name}. Nothing about payments, messages, conversations or sessions.
- **Events query** (strict, snake_case; unknown key or value → 400): `sort` (`time|actor|action`, default `time`), `dir` (default `desc`), `page`, `page_size` (10 / 25 / 50). Order: chosen sort, then `created_at desc`, then `id`. Row: `id`, `at`, `actor` (admin username), `action` (fixed Indonesian label by event type), `summary` (GRANT: "N hari" = calendar days from `starts_at` to `new_ends_at` in `Asia/Jakarta`; EXTEND: "N hari (hingga 27 Des 2026)"; REVOKE: "Akses dicabut"), `status: 'success'`, `log_id` (the `audit_log_id`, null if absent). **The reason is not in the table** (it is on the log detail), the admin id is never returned.
- **Subscriber list query** (strict; unknown → 400): `q` (trimmed, ≤ 100; name contains case-insensitive **or** Telegram id prefix; `% _ \` escaped, bound), `status` (`all|active|expired|revoked`), `ends` (`all|next7|next30|past`, the US-020 allowlist; options are placeholders), `sort` (`subscriber|telegram|status|starts|ends`, default `ends`), `dir` (default `desc`), `page`, `page_size`. ORDER BY from a fixed map, then `ends_at desc`, then `id`. Row: subscription id, `customer` {id, display_name, avatar_url (https or null), telegram_username, telegram_id}, `status`, `starts_at`, `ends_at`, `revoked_at`. Response `{ items, total, page, page_size }`. Only role-USER customers (a subscription row of a user who later became a creator cannot exist: approval is refused while one is active or future; expired / revoked history rows of a former customer are listed if the account is still USER only).
- **Grantable users** (`q` optional, ≤ 100; max 20 rows, ordered by name): role USER, status ACTIVE, with no *entitled* subscription to this creator (the shared predicate); the creator must be ACTIVE, else `{ creator_status, items: [] }` so the dialog can say why. Fields: id, display_name, avatar (https or null), `@username`, Telegram id. The actual grant is still validated by US-020's transaction (role, status, creator, active conflict).
- **Entitlement predicate** (`entitledSubscriptionSql(now)`; `isEntitled` mirrors it): `s.revoked_at IS NULL AND s.starts_at <= now AND s.ends_at > now AND cu.status = 'ACTIVE' AND cu.role = 'USER' AND c.status = 'ACTIVE' AND ou.status = 'ACTIVE'` (`cu` the customer, `c` the creator row, `ou` the creator's user). Used for: creator list `subscribers`, creator detail `subscriber_count`, user list `subs`, user detail `active_count` and `nearest_end`, grantable-users, and the US-016 block dialog's "active subscribers" count (the block dialog's count is taken before blocking, so it uses the same predicate **without** the creator status terms; the helper takes an option for that).
- **Events are append-only** (US-020 trigger); this story adds no write path.
- **Events / outbox / sockets:** none.

## Dependencies

- Prior stories: **US-020** (migration, `SubscriptionAccessService`, `isEntitled`, contracts, endpoints, dialogs, `SubscriptionsTab`), **US-015** (creator detail page + Subscriber placeholder, `/logs/:id`, `HistoryTab` pattern, `usePageCrumbs`), **US-018** (user detail page), US-017 / US-014 (list services whose counts are refactored), US-016 (block count), US-002 (`DataTable`, `StatusChip`, `Avatar`, `Select`).
- No new packages, no env, no migration of its own (the `audit_log_id` column rides in US-020's migration).
- Next free task ids after this plan: 127.

## Risks

- **Refactoring four working count queries:** each is covered by its existing tests; TASK-121 adds one consistency test (same dataset, all counts agree) and updates the tests whose expectations change on purpose (a blocked creator's count is 0, a blocked customer's subscription is not counted). Run the creator / user list and detail suites after the refactor.
- **Status chip vs count mismatch:** a row of a blocked creator or customer still shows its row status (Active) while the count excludes it. Accepted and documented; the page headers already show Blocked.
- **IDOR on subscription detail:** ownership is part of the SQL; integration tests swap ids between two users and between a user and a creator.
- **Event ↔ audit link:** depends on US-020 writing `audit_log_id`; if US-020 ships without it, View stays disabled (tested) and the amendment must be applied.
- **Undesigned bits (placeholders, logged in Known Gaps):** the user-picker variant of the grant dialog and its empty / creator-not-active states, the Berakhir filter options, the Subscriber tab for a pending request, the not-found / error states of the subscription detail, the event summary wordings beyond "30 hari", and the "Kembali" wording from a creator's Subscriber tab.
- **Dialog reuse across two hosts:** the US-020 dialogs take a host-agnostic subscription context (names + ids); TASK-125 passes it from the row. Do not fork the dialogs.
- **Prerequisites not built:** US-020 (all tasks), US-015 and US-018 are `planned` / unbuilt at the time of this plan; do not start this story before they are `ready_for_uat`.

## Tasks

### TASK-120: Subscription detail, events and subscribers contracts

`packages/contracts/src/subscription-detail.ts` (+ spec, exported); reuses `SUBSCRIPTION_STATUSES`, `SUBSCRIPTION_END_FILTERS`, the page-size constants and `SubscriptionStatus` from `subscription-access.ts` (US-020):

- `SubscriptionDetailResponseSchema` (strict): `{ subscription: { id, status, starts_at, ends_at, revoked_at | null, source: 'ADMIN', created_by_label | null }, customer: { id, display_name, telegram_username | null, telegram_id }, creator: { id, display_name } }`.
- `SubscriptionEventsQuerySchema` (strict, defaults, `SUBSCRIPTION_EVENT_SORT_FIELDS`), `SubscriptionEventRowSchema` `{ id, at, actor, action, summary, status: 'success', log_id: uuid | null }`, `SubscriptionEventsResponseSchema { items, total, page, page_size }`.
- `CreatorSubscribersQuerySchema` (strict; `q`, `status`, `ends`, `sort` in `CREATOR_SUBSCRIBER_SORT_FIELDS`, `dir`, `page`, `page_size`; defaults), `CreatorSubscriberRowSchema`, `CreatorSubscribersResponseSchema`.
- `GrantableUsersQuerySchema` `{ q }` (strict, trimmed, ≤ 100), `GrantableUsersResponseSchema { creator_status: 'ACTIVE'|'BLOCKED', items: [{ id, display_name, avatar_url, telegram_username, telegram_id }] }` (max 20).
- Shared pure helper `daysBetweenJakarta(from, to)` used by the event summaries (server) and tests.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/subscription-detail.ts`, `subscription-detail.spec.ts` | schemas, allowlists, helper |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:** defaults; every allowlist refuses unknown values (sort, dir, status, ends, page size, page, extra key, repeated key, `q` over 100); schemas are strict (an `admin_id`, `reason`, `changes`, `session_version`, `role` key is refused); avatar must be https; the events row has no reason field; `daysBetweenJakarta` at the Jakarta midnight boundary (16:59Z vs 17:00Z), month rollover (28 Okt → 27 Nov = 30), same day = 0.

---

### TASK-121: Shared entitlement predicate and count refactor

`packages/backend-core/src/subscription-access/entitlement-sql.ts` (US-020 owns `entitlement.ts`):

```ts
export function entitledSubscriptionSql(now: Date, opts?: { ignoreCreatorStatus?: boolean }): Prisma.Sql  // predicate over aliases s, cu, c, ou
export const ENTITLED_FROM: Prisma.Sql  // FROM subscriptions s JOIN users cu ON cu.id = s.customer_id JOIN creators c ON c.id = s.creator_id JOIN users ou ON ou.id = c.user_id
```

- Replace the inline subscription predicates in: `CreatorListService` (`subscribers`), `CreatorDetailService` (`subscriber_count`), `UserListService` (`subs`), `UserDetailService` (`active_count`, `nearest_end`), and the US-016 `CreatorModerationService` subscriber count (with `ignoreCreatorStatus` because it counts before the block). The request-row "Langganan aktif" mark of the creator list and `findSubscriptionBlock` keep the separate blocking rule.
- Unit-test `entitledSubscriptionSql` against `isEntitled` (US-020) over a grid of states.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/subscription-access/entitlement-sql.ts`, `entitlement-sql.int.spec.ts` | predicate + consistency test |
| MODIFY | `packages/backend-core/src/creator-list/creator-list.service.ts`, `creator-detail/creator-detail.service.ts`, `user-list/user-list.service.ts`, `user-detail/user-detail.service.ts`, `creator-moderation/creator-moderation.service.ts`, `src/index.ts` | use the predicate |
| MODIFY | the existing `.int.spec.ts` of those services | update expectations that change on purpose |

**Testing (integration):** one dataset with an active, an expired, a revoked, a not-yet-started, a blocked-customer and a blocked-creator subscription: the creator list `subscribers`, creator detail `subscriber_count`, user list `subs` and user detail `active_count` all equal the number of **entitled** rows; a blocked creator shows 0; a blocked customer is not counted; `entitledSubscriptionSql` and `isEntitled` agree for every combination (parametrised); the request-row mark and the approval block still count a **future** subscription; the US-016 count before blocking still equals the active count. All existing creator / user list, detail and moderation suites stay green.

---

### TASK-122: `SubscriptionDetailService` and `CreatorSubscribersService`

`packages/backend-core/src/subscription-detail/`:

```ts
class SubscriptionDetailService {
  constructor(prisma: PrismaClient, clock?: () => Date)
  get(userId: string, subId: string): Promise<SubscriptionDetailResponse | null>
  events(userId: string, subId: string, query: SubscriptionEventsQuery): Promise<SubscriptionEventsResponse | null>
}
class CreatorSubscribersService {
  constructor(prisma: PrismaClient, clock?: () => Date)
  list(creatorId: string, query: CreatorSubscribersQuery): Promise<CreatorSubscribersResponse | null>   // null = not a creator id
  grantableUsers(creatorId: string, q: string | null): Promise<GrantableUsersResponse | null>
}
```

- Detail / events: ownership (`customer_id = userId` and the customer is role USER) inside the lookup; admin label by username; fixed action labels and summaries; `log_id` from `audit_log_id`; one SQL for the events page with a fixed ORDER BY map.
- Subscribers list: one SQL projection joined to `users` (customer), status derived in SQL against `now` (REVOKED, else ACTIVE if `ends_at` > now, else EXPIRED), filters, fixed ORDER BY map, `total` independent of the page. Grantable users: the shared predicate to exclude entitled pairs, max 20.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/subscription-detail/subscription-detail.service.ts`, `creator-subscribers.service.ts`, `index.ts`, `.int.spec.ts` for each | services |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL, injected clock):**
- *Detail:* status for active / expired (`ends_at` = now → expired) / revoked; `created_by_label` is the latest GRANT's admin username after a re-grant by another admin; **IDOR**: another user's subscription id → null, a creator id or admin id as `userId` → null, malformed ids → null; result keys equal the contract (no admin id, reason, payment or chat field).
- *Events:* newest first by default, sort fields both ways with stable ties, pages disjoint, `total` independent, page past the end empty; summaries ("30 hari" for a grant from 28 Okt to 27 Nov, extend days, revoke); `log_id` present and pointing at the audit row, null when missing; an event of another subscription never appears.
- *Subscribers:* only this creator's rows; status derivation; status / ends filters; `q` by name, by Telegram id prefix, case-insensitive, `% _ \` literal; every sort both ways; pages; a pending application id, user id, unknown id → null; blocked customers still listed with their row status.
- *Grantable users:* excludes users with an entitled subscription, includes users with an expired or revoked one, excludes BLOCKED users and CREATOR accounts, caps at 20, `q` filter, a BLOCKED creator → `creator_status` BLOCKED with no items; non-creator ids → null.

---

### TASK-123: API endpoints and admin client

- `apps/api/src/admin/user-subscriptions/` (US-020) gains `GET :id/subscriptions/:subId` and `GET :id/subscriptions/:subId/events`; `apps/api/src/admin/creators/creators.controller.ts` gains `GET :id/subscribers` and `GET :id/grantable-users`. Queries through `ZodValidationPipe`; `null` → `AppError 404 NOT_FOUND` with one generic message; all `no-store`; providers in the existing tokens / modules.
- `apps/admin/src/auth/api-client.ts`: `getSubscription(userId, subId, signal?)`, `listSubscriptionEvents(userId, subId, query, signal?)`, `listCreatorSubscribers(creatorId, query, signal?)`, `listGrantableUsers(creatorId, q, signal?)`; same helper pattern (defaults omitted, ids encoded, response validation, one renewal retry, abort); `fake-admin-api.ts` stubs.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/user-subscriptions/user-subscriptions.controller.ts`, `.module.ts`, `tokens.ts` | detail and events routes |
| MODIFY | `apps/api/src/admin/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | subscribers and grantable users |
| CREATE | `apps/api/test/admin-subscription-detail.int.spec.ts` | API integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client calls |

**Testing (API integration, real app):** no session and a Telegram user Bearer token → 401 on all four routes; detail and events 200 for the owner's subscription, **404 with an identical body for another user's subscription id, a creator id, an admin id, unknown and malformed ids**; events paging / sort and 400 on every unknown value; subscribers list 200 with filters / sort / pages changing the backend result and 400 on unknown values, 404 for a pending application id; grantable users 200 and capped; after a US-020 grant / extend / revoke the detail, events and subscribers reflect it; no admin ids, reasons, session or chat data in any body; the endpoints never write (row counts unchanged). Client: URL building (defaults omitted, ids encoded), validation, renewal, abort.

---

### TASK-124: Subscription detail page and View wiring

`apps/admin/src/users/detail/subscriptions/SubscriptionDetailPage.tsx` + route `users/:id/subscriptions/:subId` (before the `:tab` route) and the **View** buttons of the US-020 Langganan tab (inert until now) linking to it with `from` router state:

- **Layout** per `AdmSubDetail` (back link, title card "Langganan: {customer} → {creator}", Status chip, Mulai, Berakhir with time and zone, Sumber, Dibuat oleh, Pembayaran, action buttons, "Riwayat akses" `DataTable` with Waktu, Aktor, Tindakan, Ringkasan, Status chip, Aksi View). Sortable Waktu / Aktor / Tindakan, pagination 10 / 25 / 50, URL-synced (`sort`, `dir`, `page`, `page_size`), state boards for loading / empty / error.
- **Actions:** Active → **Perpanjang** / **Cabut Akses** (US-020 `ExtendAccessDialog` / `RevokeAccessDialog` with the subscription context from the detail); expired / revoked → **Berikan Ulang** (US-020 `GrantAccessDialog`, creator locked). After a success: close, refetch detail and events, toast (the US-020 toasts). A 409 shows the conflict toast and refetches.
- **View on an event** → `/logs/<log_id>` with router state `{ from, label }` ("Kembali ke Langganan" wording is the board's; from the log page the back link is a placeholder, **design gap**); disabled when `log_id` is null.
- **Kembali ke Langganan:** back to the list URL (with its search / filters) from router state, else `/users/:id/subscriptions`.
- States: loading, not found (generic, a link back to the Langganan tab; **design gap**), error with retry; breadcrumb `Dashboard / User / <name> / Langganan / Detail`. All names and reasons rendered as text.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/detail/subscriptions/SubscriptionDetailPage.tsx`, `useSubscriptionDetail.ts`, `events-url.ts`, `subscription-detail.module.css` | page |
| MODIFY | `apps/admin/src/users/detail/subscriptions/SubscriptionsTab.tsx` (View → detail), `apps/admin/src/app/routes.tsx`, `apps/admin/src/users/copy.ts` | wiring, copy (placeholders flagged) |
| CREATE | `apps/admin/src/users/detail/subscriptions/SubscriptionDetailPage.spec.tsx`, `events-url.spec.ts` | component tests |
| MODIFY | `visual/specs/visual.spec.ts`, `apps/admin/test/subscription-fixtures.ts` | `AdmSubDetail` screenshot, fixtures |

**Testing:** component tests: the board copy and rows for Active, Kedaluwarsa and Dicabut; Perpanjang / Cabut only when Active, Berikan Ulang otherwise; each action calls the US-020 API with the subscription id and refetches; events table (sort / page / size change the request and URL, stale response ignored, states); View links to the log with state and is disabled without a log id; back link returns the previous filters; 404 and error + retry; text rendered as text. Playwright 1440 × 760 against `AdmSubDetail` (page content next to the board's `main`).

---

### TASK-125: Creator Subscriber tab

`apps/admin/src/creators/detail/subscribers/` replacing the placeholder on `/creators/:id/subscribers` (board `AdmCrSubs`, state boards `AdmTableStates`):

- Toolbar "Cari nama atau Telegram ID", `Status akses: Semua`, `Berakhir: Semua` (placeholder options), **Reset Filter**, **Berikan Akses** (primary; disabled with the inert tooltip while the creator is BLOCKED, since a grant to a blocked creator is refused).
- Table: Subscriber (avatar + name), Telegram (`@username` over `ID …`), Status akses (`StatusChip` Active / Kedaluwarsa / Dicabut), Mulai, Berakhir, Aksi. Active rows: **View** (→ `/users/:customerId`), **Perpanjang**, **Cabut** (red); expired / revoked: **View**, **Berikan Ulang**. Sortable headers, pagination 10 / 25 / 50, "Menampilkan 1–8 dari 58 hasil", view state in the URL (pattern of the History tab), abort handling, state boards. Buttons never wrap.
- Row actions open the **US-020 dialogs** with the context `{ userId: customer.id, subscriptionId, customerName, creatorName }` and call the US-020 endpoints; success → close, refetch the table **and the creator detail** (header count / Ringkasan), toast.
- A creator whose detail kind is `request` shows the empty table state and no toolbar actions (no API call).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/creators/detail/subscribers/SubscribersTab.tsx`, `useSubscribers.ts`, `subscribers-url.ts`, `subscribers.module.css` | tab |
| MODIFY | `apps/admin/src/creators/detail/CreatorDetailPage.tsx` (render the tab, reload the detail after a change), `apps/admin/src/creators/copy.ts` | wiring, copy (placeholders flagged) |
| CREATE | `apps/admin/src/creators/detail/subscribers/SubscribersTab.spec.tsx`, `subscribers-url.spec.ts` | component tests |
| MODIFY | `visual/specs/visual.spec.ts` | `AdmCrSubs` screenshot |

**Testing:** rows and the right actions per status; search / filters / sort / paging change the request and the URL; Reset Filter; states; View links to the user detail; Perpanjang / Cabut / Berikan Ulang call the US-020 endpoints with the **customer id and subscription id of the row** (not the creator id), refetch the table and the creator detail, show the toasts; a 409 shows the conflict toast and refetches; Berikan Akses disabled for a Blocked creator; a request-kind detail shows the empty state with no API call; text rendered as text. Playwright 1440 × 1300 against `AdmCrSubs`.

---

### TASK-126: Berikan Akses with the user picker (placeholder-flagged)

`apps/admin/src/creators/detail/subscribers/GrantToUserDialog.tsx`: the `AdmDlgGrant` card (identity of the **creator**, Durasi select 7 / 30 / 90 hari default 30 with "Tanggal khusus", computed "Tanggal berakhir" via `computeEndDate`, required **Alasan (wajib)**, the verbatim body sentence, Batal / Berikan Akses) with the **Creator select replaced by a user picker**:

- A searchable list (input "Cari nama atau Telegram ID", debounced, results from `grantable-users`, max 20, one selectable at a time, selected user shown as a chip with name and `@username · ID`); empty state "Tidak ada user yang bisa diberi akses" and, for a BLOCKED creator, an explanation line. All of this is **placeholder copy and layout, flagged as a design gap**.
- Confirm calls the US-020 grant endpoint with the picked user's id (`POST /v1/admin/users/:userId/subscriptions { creator_id, duration_days | end_date, reason }`); success → toast `AdmUserSubsGranted` wording ("Akses {user} ke {creator} diberikan hingga {date}"), refetch table and detail; 409 conflicts (`SUBSCRIPTION_ACTIVE`, user blocked or not a USER, creator not active) close with the conflict toast and refetch; failure keeps the dialog open with the banner.
- Reuse the US-020 dialog internals (duration, end-date preview, reason, `ConfirmDialog` behaviour); only the target selector differs. Do not fork the logic: extract the shared fields if the US-020 dialog does not already expose them.
- Add the user-picker dialog and the other gaps to `design-integration.md` Known Gaps; `codebase-map.md` at completion.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/creators/detail/subscribers/GrantToUserDialog.tsx`, `UserPicker.tsx`, `grant-to-user.module.css` | dialog and picker |
| MODIFY | `apps/admin/src/users/detail/subscriptions/GrantAccessDialog.tsx` (extract the shared fields only if needed), `SubscribersTab.tsx`, `apps/admin/src/creators/copy.ts`, `apps/admin/src/preview/Preview.tsx` | wire, copy, preview |
| CREATE | `apps/admin/src/creators/detail/subscribers/GrantToUserDialog.spec.tsx` | component tests |
| MODIFY | `.agile/guidelines/design-integration.md`, `.agile/guidelines/codebase-map.md` | gaps, built state |

**Testing:** search sends the typed value after the debounce and shows only server results; selecting a user enables confirm only with a reason; end-date preview matches `computeEndDate` and the custom date; confirm sends one request with the picked user id and the creator id (double click sends once, buttons disabled in flight); empty reason shows "Alasan wajib diisi." and keeps the dialog and typed text; each 409 closes with the conflict toast and refetches; failure keeps the dialog; BLOCKED creator shows the explanation and no results; names rendered as text. Playwright of the dialog card at 1440 against `AdmDlgGrant` only where the layout is shared (the picker differs and is not compared, noted in the QA report).

---

## Implementation order

(US-020, US-015, US-018 first) → TASK-120 → TASK-121 → TASK-122 → TASK-123 → TASK-124 → TASK-125 → TASK-126 (rebuild `contracts` and `backend-core` before the API and admin see them). TASK-121 can run right after US-020's migration and service exist; run all creator / user list and detail suites afterwards.

## Open inputs

- **Not designed (placeholders, Known Gaps):** the user-picker variant of `AdmDlgGrant`, its empty and blocked-creator states, the Berakhir filter options, the Subscriber tab for a pending request, the subscription detail's not-found / error states, the log back-link wording from a subscription, and the event summary wordings beyond "30 hari".
- **Behaviour change to announce at completion:** counts now follow the full entitlement rule, so a blocked creator shows 0 subscribers and a blocked customer is not counted; the US-015 / US-018 tests that assumed otherwise are updated.
- **Prerequisites:** US-020 (with the `audit_log_id` amendment), US-015 and US-018 must be built first.
- At story completion (dev-team): `codebase-map.md` (endpoints, routes, inventory), QA reports, `completed.json`, `sprint.json`.
