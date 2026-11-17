# Technical Plan: US-018 — Admin user detail, creator requests and history

> Task ids 102–107 (091–097 belong to US-015, 098–101 to US-017). **Depends on US-015 being built first** (agreed with the user, 2026-11-16): this plan reuses its `audit-labels.ts`, history SQL pattern, `AuditLogService` + `/logs/:id` Detail Log page, `usePageCrumbs()`, the detail-page header/tab patterns and the history table. Also builds on US-017 (`/users` list, `/users/:id` placeholder) and US-012 (approve / reject dialogs).

## Architecture Overview

Agreed with the user: Block / Unblock in the header were **planned inert** until US-019. **Update (US-019 built first):** the header buttons are live here, opening the US-019 `BlockUserDialog` / `UnblockUserDialog` (acceptance handed over from US-019, with `AdmUserBlockedDone`); the Langganan tab is the "belum dibangun" placeholder until Phase C.

Four read endpoints and one detail page with four tabs:

```
GET /v1/admin/users/:id                       → UserDetailService.get(id)        (header + Ringkasan data)
GET /v1/admin/users/:id/requests?…            → UserRequestsService.list(id, q)  (Pengajuan Creator table + banner data)
GET /v1/admin/users/:id/requests/:reqId       → UserRequestsService.get(id, reqId) (AdmReqDetail / AdmReqDetailRej)
GET /v1/admin/users/:id/history?…             → UserHistoryService.list(id, q)   (reuses US-015 audit labels / SQL pattern)

/users/:id                  Ringkasan          (AdmUserSummary | AdmUserBlocked)
/users/:id/subscriptions    Langganan          placeholder (Phase C)
/users/:id/requests         Pengajuan Creator  (AdmUserRequest) ── View ──▶ /users/:id/requests/:reqId (AdmReqDetail | AdmReqDetailRej)
/users/:id/history          History            (AdmUserHistory) ── View ──▶ /logs/:id (US-015 Detail Log)
```

- **Only USER accounts are "users".** `GET /users/:id` for a CREATOR's id answers a distinct, safe `{ role: 'CREATOR', creator_id }` shape (200) and the page redirects (`replace`) to `/creators/:id`; an unknown or malformed id is 404 (not-found state). Nothing else about the creator is returned.
- **Ringkasan** (`AdmUserSummary`, `AdmUserBlocked`): "Profil aplikasi" (display name, bio or "–", `@username`, role), "Ringkasan langganan" (active count, expired count, nearest end as "Creator, 27 Nov 2026" from the server; **Kelola Langganan** → `/users/:id/subscriptions`), "Status pengajuan creator" (Belum mengajukan / Menunggu / Ditolak, Diajukan date-time WIB, "Pernah ditolak: n kali (date of the latest)" when n > 0, **Detail Pengajuan** → the latest request's detail), and the footer note "Isi percakapan privat tidak ditampilkan di halaman detail user." The Blocked variant adds the red banner with the block reason and admin from the audit trail (see rules) and has no creator-request block change.
- **Pengajuan Creator tab** (`AdmUserRequest`): a banner while a request is PENDING ("Pengajuan menunggu peninjauan…"), and if an active or future customer subscription blocks approval, the reason line with creator and end date ("Tidak bisa disetujui sekarang: akun ini punya 1 langganan pelanggan aktif (Salsa Maheswari, hingga 27 Nov 2026)."). Below it a server-side table of **all this user's requests**: Diajukan, Pengajuan (`Pengajuan ke-n`, n = rank by `created_at` ascending, computed in SQL so it is stable under filtering), Status chip, Ringkasan ("Menunggu peninjauan" / "Ditolak 5 Nov 2026: <reason>"), View. Search (matches the summary text), Status filter (Semua / Menunggu / Ditolak), sort, pagination, Reset Filter.
- **Request detail** (`AdmReqDetail` pending with Setujui / Tolak wired to the US-012 dialogs, `AdmReqDetailRej` rejected with reason, reviewer and time and **Lihat di Log** → the rejection's audit row in `/logs/:id`). Ownership is checked in SQL: a request whose `user_id` differs from `:id` is 404, identical to an unknown id.
- **History** (`AdmUserHistory`): the same table as the creator History (US-015 `HistoryTab`, now parameterised by the API call and the target route), scoped to this user.
- **No new tables, no migration.** Read-only; the only writes are the existing US-012 approve / reject calls from the request detail.

Brief refs: §11 (User detail, "Semua tabel"), §15 (no chat, no secrets in admin views). Design refs: `AdmUserSummary`, `AdmUserBlocked`, `AdmUserRequest`, `AdmReqDetail`, `AdmReqDetailRej`, `AdmUserHistory`, `AdmTableStates`; `AdmLogDetail` (US-015). Route map: `/users/:id` (tabs ringkasan, subscriptions, creator-request, history), `/users/:id/requests/:reqId`. `AdmUserBlockedDone`, `AdmDlgUserBlock` / `Unblock` belong to US-019; `AdmUserSubs*` to Phase C.

Out of scope: Block / Unblock behaviour (US-019), the Langganan tab and grant / extend / revoke (US-020), subscription detail (`AdmSubDetail`, US-021), the Log & History list pages (Phase G).

## Authorization & Data Rules

- **Principal:** admin only (`CsrfGuard` + `AdminJwtGuard`; a user token is 401). All four endpoints are GET, `Cache-Control: no-store`, write nothing (no audit row for reading).
- **Id rules:** `:id` and `:reqId` must be UUIDs, otherwise 404. `:id` resolves in `users` only. Role USER → detail. Role CREATOR → the redirect shape. Nothing found → 404 with one generic message for every not-found case (no hint which part was wrong). For requests, the SQL always filters by both `application.id = :reqId AND application.user_id = :id`.
- **Detail fields:** identity (name, avatar https only, `@username`, Telegram id, `joined_at`), `status` ACTIVE / BLOCKED, `bio`, `role`. Subscription summary: `active_count` (started, not ended, not revoked), `expired_count` (ended, not revoked), `nearest_end` = `{ creator_name, ends_at }` of the active one ending soonest, else null. Creator-request block: `status` NONE / PENDING / REJECTED (latest application; as in the list), `submitted_at` (latest application), `rejection_count`, `last_rejected_at`, `latest_request_id`. No chat, media, notification or session data.
- **Block reason (Blocked variant):** the latest `user.account.blocked` audit row for this user, giving `{ reason, admin_label, at }` if it carries them; null when absent (US-019 will start writing reasons, today's blocks come from the seed / `AccountSecurityService`, so the banner then shows without the reason). Never returns the raw `changes`.
- **Requests query** (strict, snake_case; unknown key or value → 400): `q` (trimmed, ≤ 100, matches the summary text, LIKE-escaped, bound), `status` (`all|pending|rejected`, default all), `sort` (`date|status`, default `date`), `dir` (default `desc`), `page`, `page_size` (10/25/50). Order: chosen sort, then `created_at desc`, then `id`. `Pengajuan ke-n` is `row_number() OVER (PARTITION BY user_id ORDER BY created_at, id)` computed before filtering. An APPROVED application cannot belong to a USER and is mapped to nothing special (it is simply not a status in the contract; the query excludes it).
- **Request detail fields:** the application (`creator_name`, `instagram_url`, `creator_type`, `description`, `rights` = fixed "Dikonfirmasi" because a stored request always has it, `status`, `created_at`), the applicant block (display name, `@username`, Telegram id), for PENDING the approval pre-check from `findSubscriptionBlock` (count, creator, end date), for REJECTED `review_reason`, `reviewed_at`, reviewer label (admin username, never the admin id) and `log_id` (the audit row `creator.application.rejected` for that application, null if none). Reason and descriptions are shown as text.
- **History query** is the US-015 contract (`q`, `type`, `status`, `sort`, `dir`, `page`, `page_size`) and the same fixed label map and projection; scope for a user: `audit_logs` where `(target_type = 'user' AND target_id = :id) OR (target_type = 'creator_application' AND target_id IN the user's application ids)`. Nothing returned except the allowlisted columns.
- **Escaping / privacy:** names, bios, reasons rendered as text only.
- **Events / outbox / sockets:** none.

## Dependencies

- Prior stories: **US-015** (`audit-labels.ts`, history SQL, `AuditLogService`, `/logs/:id`, `usePageCrumbs`, `HistoryTab`), US-017 (`/users` list and placeholder route), US-012 (`ApproveRequestDialog`, `RejectRequestDialog`, `findSubscriptionBlock`, `approvedBanner`, `rejectedToast`), US-014 (`list-url` pattern, `DataTable` usage, `paletteFor`), US-002 (`Tabs`, `KvList`, `Card`, `StatusChip`), US-003 (admin session).
- No packages, no env, no migration.

## Risks

- **IDOR on the request detail** (viewing someone else's request through `/users/:id/requests/:reqId`): ownership is in the SQL `WHERE`; integration test with two users and swapped ids.
- **Wrong history scope:** tests with two people and cross targets; a rejected request's events appear under its applicant.
- **Reuse drift with US-015** (the history table and labels): extend, don't copy; if US-015 changes shape, adapt the shared parts only.
- **Undesigned bits:** the creator-id redirect (no board), the not-found state, the History Jenis options and the Pengajuan filter options are placeholders flagged in Known Gaps. The board's `AdmUserHistory` shows access events (Berikan akses, Akses berakhir) that are not audited until Phase C; they appear once those flows write audit rows.
- **Stale state after a decision from the request detail:** refetch the request, the detail and the list state after approve / reject; an approve moves the person to creators, so the page navigates to `/creators/<creator id>`.

## Tasks

### TASK-102: User detail, requests and history contracts

`packages/contracts/src/user-detail.ts` (+ spec, exported):

- `UserDetailResponseSchema`: a discriminated union on `role`: `USER` → `{ role: 'USER', user: { id, display_name, avatar_url (https or null), telegram_username, telegram_id, status, bio: string | null, joined_at }, subscriptions: { active_count, expired_count, nearest_end: { creator_name, ends_at } | null }, creator_request: { status: 'NONE'|'PENDING'|'REJECTED', submitted_at: string | null, rejection_count, last_rejected_at: string | null, latest_request_id: uuid | null }, block: { reason: string | null, admin_label: string | null, at: string } | null }` (strict; `block` only when the status is BLOCKED) and `CREATOR` → `{ role: 'CREATOR', creator_id }`.
- `UserRequestsQuerySchema` (strict, defaults, allowlists as above, `USER_REQUEST_SORT_FIELDS`, `USER_REQUEST_STATUSES`), `UserRequestRowSchema` (`id`, `created_at`, `ordinal`, `status` PENDING|REJECTED, `summary`), `UserRequestsResponseSchema` `{ items, total, page, page_size, pending: { id, subscription_block: ApprovalBlock | null } | null }` (the banner data, independent of filters and page).
- `UserRequestDetailSchema`: `{ request: {...}, applicant: {...}, check: { block } | null, review: { reason, reviewed_at, reviewer_label, log_id } | null }`, with a refinement tying `check` to PENDING and `review` to REJECTED.
- `UserHistory*`: reuse the US-015 `HistoryQuerySchema`, row and response schemas (re-export under user names, no copy).
- `ADMIN_USERS_PATH` helpers for the sub-routes.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/user-detail.ts`, `user-detail.spec.ts` | schemas, allowlists |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:** defaults; every allowlist refuses unknown values (sort, dir, status, page size, page, extra key, repeated key); the union accepts both shapes and refuses mixed fields; `block` only with BLOCKED (refinement); `check` / `review` tied to the status; every schema strict (a leaked `role`, `session_version`, `admin_id`, `changes` key is refused); avatar must be https.

---

### TASK-103: `UserDetailService`, `UserRequestsService`, `UserHistoryService`

`packages/backend-core/src/user-detail/`:

```ts
class UserDetailService {
  constructor(prisma: PrismaClient, opts?: { clock?: () => Date })
  get(id: string): Promise<UserDetailResponse | null>        // null = not found
}
class UserRequestsService {
  constructor(prisma: PrismaClient, opts?: { clock?: () => Date })
  list(userId: string, query: UserRequestsQuery): Promise<UserRequestsResponse | null>
  get(userId: string, requestId: string): Promise<UserRequestDetail | null>   // ownership in SQL
}
class UserHistoryService {
  constructor(prisma: PrismaClient)
  list(userId: string, query: HistoryQuery): Promise<HistoryResponse | null>
}
```

- `UserDetailService.get`: one query for the user, role branch (CREATOR → redirect shape using the `creators` row; a CREATOR user without a creator row → null), the subscription counts and nearest end, the latest-application state (same rule as the list: APPROVED → NONE), rejection count and last rejection, and for BLOCKED users the latest `user.account.blocked` audit row (reason read from the allowlisted field if present, admin label by username).
- `UserRequestsService.list`: the `row_number()` CTE, filters, fixed ORDER BY map, tie-breakers, summary text built in SQL from status / reason / reviewed date; plus the independent `pending` banner data using `findSubscriptionBlock`. `get`: the owned request, `findSubscriptionBlock` for PENDING, reviewer label and `log_id` lookup for REJECTED. Returns null for another user's request, an unknown id or a user that is not role USER.
- `UserHistoryService.list`: the US-015 history projection with the user scope rule (share the SQL builder from `CreatorHistoryService`; extract it, don't copy).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/user-detail/user-detail.service.ts`, `user-requests.service.ts`, `user-history.service.ts`, `index.ts` + `.int.spec.ts` for each | services |
| MODIFY | `packages/backend-core/src/creator-detail/creator-history.service.ts` | extract the shared history SQL builder |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL):**
- *Detail:* a USER with no request / pending / rejected-twice (counts and last date correct); subscription counts and nearest end with active, expired, revoked and future rows (only the first two count, revoked and future never); a BLOCKED user shows the block with reason and admin when the audit row has them and `block` with nulls when it has not; a CREATOR id → redirect shape; a CREATOR without a creator row, a random UUID, an admin id → null; avatar `http:` dropped; result keys equal the contract.
- *Requests:* a user with 3 requests gets ordinals 1..3 in time order regardless of filter / sort; status filter, `q` (case-insensitive, `% _ \` literal), sort fields both ways with stable ties, pages disjoint and `total` independent, a page past the end empty; `pending` banner data present only with a PENDING request, with the block for an active **or future** subscription and none for revoked / expired; **IDOR:** another user's request id under this user → null, a request id under a CREATOR id → null; reviewer label is the username, `log_id` points at the rejection audit row (null when missing).
- *History:* only this user's events (two users, cross targets); a rejected application's events appear under its applicant; other people's applications never; filters / sort / paging as in US-015; unknown user → null.

---

### TASK-104: API endpoints and admin client

- `apps/api/src/admin/users/users.controller.ts` (US-017) gains `GET :id`, `GET :id/requests`, `GET :id/requests/:reqId`, `GET :id/history` (guards already on the controller; query through the Zod pipe; `null` → `AppError 404 NOT_FOUND` with one generic message; ids validated). Providers for the three services in `users.module.ts` / `tokens.ts`. All `no-store`.
- `apps/admin/src/auth/api-client.ts`: `getUserDetail(id, signal?)`, `listUserRequests(id, query, signal?)`, `getUserRequest(id, reqId, signal?)`, `listUserHistory(id, query, signal?)`; same helper pattern (defaults omitted, ids encoded), response validation, one-renewal retry, abort; `fake-admin-api.ts` stubs.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/users/users.controller.ts`, `users.module.ts`, `tokens.ts` | routes |
| CREATE | `apps/api/test/admin-user-detail.int.spec.ts` | integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client calls |

**Testing (API integration, real app):** no session and a Telegram user Bearer token → 401 on all four routes; detail 200 for a user without a request, a pending, a rejected and a blocked user (shape per contract); a creator id → 200 redirect shape; unknown, malformed and admin ids → 404 with the standard error body (identical message); requests list filters / sort / pages change the result and 400 on every unknown sort / status / page size / key; request detail 200 for an owned pending and rejected request, **404 for a request that belongs to another user**; history 200 and 400 as in US-015; **no chat data, secrets, admin ids or raw `changes`** in any body; no writes (row counts unchanged). Client: URL building, validation, renewal, abort.

---

### TASK-105: User detail page: header, tabs, Ringkasan, not found, creator redirect

`apps/admin/src/users/detail/` and routes `users/:id`, `users/:id/(subscriptions|requests|history)`:

- **Shell:** breadcrumb override via the US-015 `usePageCrumbs()` (`Dashboard / User / <name> [/ tab]`), title "Detail User".
- **Header card** (`AdmUserSummary`, `AdmUserBlocked`): avatar or initials disc, name + `StatusChip` (Active / Blocked), `@username · ID`, "Bergabung 12 Okt 2026", and the **Block / Unblock** button per status: **inert** (disabled, `USER_LIST_COPY.inertAction` tooltip) until US-019.
- **Tabs** (links to sub-routes): Ringkasan, Langganan, Pengajuan Creator, History; Langganan shows the neutral "belum dibangun" panel.
- **Ringkasan:** three cards and the privacy note as described; **Kelola Langganan** → `/users/:id/subscriptions`; **Detail Pengajuan** → `/users/:id/requests/<latest_request_id>` (hidden when `NONE`); the Blocked variant adds the banner (text per board; the reason clause only when present).
- **States:** loading skeleton, not-found state (heading and "Kembali ke daftar user" link, no detail of why; **design gap**), error with retry, creator redirect (`replace` to `/creators/<creator_id>`).
- Applicant text rendered as text.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/detail/UserDetailPage.tsx`, `UserHeader.tsx`, `UserSummary.tsx`, `useUserDetail.ts`, `user-detail.module.css` | page |
| MODIFY | `apps/admin/src/users/copy.ts` | board copy (placeholders flagged) |
| MODIFY | `apps/admin/src/app/routes.tsx` | routes (replace the `users/:id` placeholder) |
| CREATE | `apps/admin/src/users/detail/UserDetailPage.spec.tsx` | component tests |
| MODIFY | `visual/specs/visual.spec.ts`, `apps/admin/test/user-list-fixtures.ts` (detail fixtures) | screenshots |

**Testing:** component tests for Active and Blocked variants (board copy, the subscription numbers and nearest end, "Belum mengajukan" / "Menunggu" / "Ditolak" with "Pernah ditolak 1 kali (5 Nov 2026)", Block / Unblock disabled without calls, privacy note, Kelola Langganan and Detail Pengajuan targets), tabs navigate by URL and Langganan shows the placeholder, not-found for 404, error + retry, creator shape redirects to `/creators/<id>`, text rendered as text, breadcrumb shows the name. Playwright at 1440 px: `AdmUserSummary`, `AdmUserBlocked` (page content next to each board's `main`).

---

### TASK-106: Pengajuan Creator tab and request detail page

- **Pengajuan Creator** (`/users/:id/requests`, `AdmUserRequest`): banner (pending, plus the blocking-subscription reason line from `pending.subscription_block`) and the `DataTable` with columns Diajukan (`13 Nov 2026, 14.20`), Pengajuan (`Pengajuan ke-n`), Status chip, Ringkasan, Aksi (**View** → `/users/:id/requests/:reqId`); toolbar "Cari pengajuan", Status (Semua / Menunggu / Ditolak), Reset Filter; filters, sort, page in the URL (`q`, `status`, `sort`, `dir`, `page`, `page_size`), same patterns as the user list (abort handling, state boards).
- **Request detail** (`/users/:id/requests/:reqId`): `AdmReqDetail` (pending: applicant, Instagram, Jenis creator, Deskripsi, Pernyataan hak "Dikonfirmasi", Status peninjauan, Diajukan, Pemeriksaan langganan card, **Setujui** / **Tolak** open the US-012 dialogs with the request id; approve disabled with the board's explanation when blocked) or `AdmReqDetailRej` (rejected: Hasil peninjauan, Ditinjau oleh, Waktu, Alasan, **Lihat di Log** → `/logs/<log_id>`, hidden when null). Back link to the Pengajuan Creator tab; not-found and error states; breadcrumb `Dashboard / User / <name> / Pengajuan / Detail`.
- **Decisions from here:** approved → toast `approvedBanner` and navigate to `/creators/<creator id>`; rejected → toast `rejectedToast`, refetch (the page becomes `AdmReqDetailRej`); already reviewed (409) → refetch only.
- Add the Status filter options and the not-found wording to `design-integration.md` Known Gaps if not designed.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/detail/RequestsTab.tsx`, `requests-url.ts`, `requests-url.spec.ts`, `useUserRequests.ts`, `RequestDetailPage.tsx`, `request-detail.module.css` | table and detail |
| MODIFY | `apps/admin/src/users/copy.ts`, `apps/admin/src/app/routes.tsx`, `.agile/guidelines/design-integration.md` | copy, routes, gaps |
| CREATE | `apps/admin/src/users/detail/RequestsTab.spec.tsx`, `RequestDetailPage.spec.tsx` | component tests |
| MODIFY | `visual/specs/visual.spec.ts` | screenshots |

**Testing:** table (columns and copy, ordinals, View links, banner only with a pending request and with the blocking reason when present, every filter / search / sort / page-size change sends its value and resets the page, URL round trip and garbage fallback, stale response ignored, loading / empty / no-results / error states, summary text rendered as text); request detail (pending and rejected variants per board, Setujui / Tolak call the US-012 API with the request id and a double click sends one call, approve success navigates to `/creators/<id>` with the toast, blocked approval stays in the dialog, reject shows the toast and the rejected variant, 409 refetches only, Lihat di Log target and hidden when null, 404 and error). Playwright at 1440 px: `AdmUserRequest`, `AdmReqDetail`, `AdmReqDetailRej`.

---

### TASK-107: User History tab

- **History** (`/users/:id/history`, `AdmUserHistory`): reuse the US-015 `HistoryTab` / `history-url` / `useCreatorHistory`, parameterised by `{ load: (query, signal) => Promise<…>, logLinkState }` so the creator and user pages share one table. Columns, filters, sort, paging, state boards and `View → /logs/:id` exactly as US-015; the Detail Log back link from here is "Kembali ke History User" (placeholder wording, **design gap**, with router state `from`).
- Only the thin wrapper and the API call are new; do not copy the table code.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/creators/detail/HistoryTab.tsx`, `useCreatorHistory.ts` | parameterise the loader and the back-link state |
| CREATE | `apps/admin/src/users/detail/UserHistoryTab.tsx` | thin wrapper |
| MODIFY | `apps/admin/src/logs/LogDetailPage.tsx` | back-link wording for a user's history |
| CREATE | `apps/admin/src/users/detail/UserHistoryTab.spec.tsx` | component tests |
| MODIFY | `visual/specs/visual.spec.ts`, `.agile/guidelines/design-integration.md`, `.agile/guidelines/codebase-map.md` | screenshot, gap wording, at completion |

**Testing:** the shared table keeps its US-015 tests passing; user wrapper calls `listUserHistory` with the user id and every query change; View carries `from`; the Detail Log back link goes to the user's History; states; actor / summary rendered as text. Playwright at 1440 px: `AdmUserHistory`.

---

## Implementation order

(US-015 first) → TASK-102 → TASK-103 → TASK-104 → TASK-105 → TASK-106 → TASK-107 (rebuild `contracts` and `backend-core` before the API and admin see them).

## Open inputs

- **Not designed:** the not-found state and the creator-id redirect of `/users/:id`, the Pengajuan Status filter options, the History Jenis options (shared with US-015) and the Detail Log back-link wording from a user's History: placeholders flagged in Known Gaps.
- **Block / Unblock** are inert until US-019 (`AdmUserBlockedDone`, `AdmDlgUser*` belong there); the Blocked banner's reason clause appears only when an audit row carries it.
- **Langganan tab** is a placeholder until Phase C; access events in History appear once Phase C writes them.
- **Prerequisite:** US-015 (TASK-091…097) must be built before this story is started.
- At story completion (dev-team): `codebase-map.md` (endpoints, routes, inventory), QA reports, `completed.json`, `sprint.json`.
