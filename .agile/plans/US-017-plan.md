# Technical Plan: US-017 — Admin user list

## Architecture Overview

Agreed with the user (2026-11-16): same shape as US-014. Block / Unblock are **rendered but inert** until US-019; the **Bergabung** filter offers **Semua / 7 / 30 / 90 hari** (placeholder copy); `AdmUsers` exists only at 1440, so tablet and mobile reuse the creator list's responsive treatment and are **flagged as design gaps**.

```
GET /v1/admin/users?q&status&request&range&sort&dir&page&page_size
  AdminJwtGuard ──▶ UserListService.list() (backend-core, one raw SQL projection)
                      users WHERE role = 'USER'
                        + latest creator_application (LATERAL, by created_at desc, id desc)
                        + count of active subscriptions
                    ──▶ { items, total, page, page_size }
/users (admin) ──▶ DataTable (packages/ui) + toolbar, state in the URL
   row actions: View → /users/:id (placeholder until US-018) · Block/Unblock inert (US-019)
```

- **Only USER accounts.** `users.role = 'USER'`. Approval converts the same account to CREATOR (US-012), so it leaves this list on the next fetch and appears in the creator list. Admin accounts are a separate table and never appear.
- **Pengajuan creator** comes from the user's **latest** application: none → `NONE` (Belum mengajukan), `PENDING` → Menunggu, `REJECTED` → Ditolak. A latest `APPROVED` cannot coexist with role USER (approval changes the role in the same transaction); the query maps it to `NONE` defensively rather than failing.
- **Server-side everything.** Search, filters, sort, pagination, totals and the "Menampilkan x–y dari n hasil" range come from the API. Sort fields and filter values are allowlisted; anything unknown is a 400.
- **Row identity:** `id` is the user id (what `/users/:id` in US-018 resolves).
- **No private data.** Identity, Telegram handle/id, status, counts, request state, join date. No chat, media, bio, reason text, application text, or admin ids.
- **Reuse, don't rebuild.** Same layering and the same page skeleton as `apps/admin/src/creators/` (toolbar, URL state helpers, fetch hook with abort, `DataTable`, `StatusChip`, `Avatar`, `format.ts` Indonesian dates, `useLayoutMode`). Generalise a helper only when copying it would duplicate more than ~15 lines (see TASK-101).

Brief refs: §11 (User list, "Semua tabel"), §17. Design refs: `AdmUsers` (1440), `AdmTableStates`. Board map: `/users`. `AdmUsersToastUnblock` belongs to US-019.

Out of scope: Block / Unblock behaviour (US-019), the detail page (US-018), grant/extend/revoke (US-020).

## Authorization & Data Rules

- **Principal:** admin only (`CsrfGuard` + `AdminJwtGuard` like the other admin controllers; a user Bearer token is 401). `Cache-Control: no-store`.
- **Query contract** (`snake_case`, strict: an unknown key is a 400): `q` (trimmed, ≤ 100 chars, empty = none), `status` (comma list of `active|blocked`, default both), `request` (comma list of `none|pending|rejected`, default all three), `range` (`all|7d|30d|90d`, default all), `sort` (`name|telegram|status|subscriptions|request|date`, default `date`), `dir` (`asc|desc`, default `desc`), `page` (≥ 1, ≤ 100 000), `page_size` (`10|25|50`, default 10). The UI shows a single-select for each filter ("Semua" or one value) but the contract accepts lists, matching the creator list's `status` pattern; an empty list is a 400.
- **Search:** case-insensitive "contains" on `display_name` **or** prefix match on the Telegram id (`telegram_id::text LIKE`); `%`, `_`, `\` escaped. Values are bound parameters; ORDER BY column and direction come from a fixed map keyed by the allowlisted value. No `@username` search (the board's placeholder says name or Telegram ID).
- **Order is total:** chosen sort, then `date desc`, then `id`.
- **Langganan aktif:** count of the user's **customer** subscriptions with `starts_at <= now < ends_at` and `revoked_at IS NULL` (clock injected). Future subscriptions are not counted here (the count means "active now"), unlike the US-010/012 *blocking* rule.
- **Bergabung:** `users.created_at`; `range` compares to `now - N days` using the injected clock.
- **Status:** `users.status` ACTIVE / BLOCKED.
- **Page beyond the end** returns `items: []` with the real `total`.
- **No writes** in this story. Block / Unblock stay inert.
- **Indexes:** none added (admin-sized data). `users(role, created_at)` is a Phase H candidate.
- **Events / outbox / sockets:** none.

## Dependencies

- Prior stories: US-014 (list patterns and components), US-003 (admin session), US-002 (`DataTable`, `Select`, `StatusChip`, `Avatar` in `packages/ui`), US-010 (`creator_applications`, `subscriptions`).
- No new packages, no migration. Seed already has Maya (pending), Raka (pending + subscription), Luna (rejected); the board's 10-row page of 1.262 users is reproduced with fake-API / preview fixtures, not seed data.

## Risks

- **Latest-application join picking the wrong row** (a rejected then resubmitted user shown as Ditolak): LATERAL ordered by `created_at desc, id desc`; integration test covers reject → resubmit → Menunggu.
- **A promoted user lingering in the list:** the role filter is in the query; test approves a request and expects the row gone.
- **Count correctness** (expired, revoked, future counted as active): explicit cases in the service test.
- **Tablet / mobile are undesigned:** reuse creator list layout, record in Known Gaps in `design-integration.md`.
- **Duplicated list code drifting from the creator list:** keep the page small, share the URL/format helpers where it is cheap.
- **Stale rows / slow responses:** abort the previous request on URL change, as in US-014.

## Tasks

### TASK-098: User list contract

`packages/contracts/src/user-list.ts` (+ `.spec.ts`, exported from `index.ts`):

- `UserListQuerySchema` (strict) parsing the query above from strings: `status` and `request` split on commas, de-duplicated, every item allowlisted (empty list → 400), `page` / `page_size` coerced from numeric strings with the stated bounds and the `10|25|50` set, defaults applied, `q` trimmed (all-space → none). Export the allowlists as constants (`USER_LIST_SORT_FIELDS`, `USER_LIST_STATUSES`, `USER_LIST_REQUEST_STATES`, `USER_LIST_RANGES`) and reuse the existing page-size constant from `creator-list.ts` (import or move to a shared file; do not duplicate it).
- `UserListRowSchema` (strict): `id` (uuid), `display_name`, `avatar_url` (https or null), `telegram_username` (nullable), `telegram_id` (string), `status` (`ACTIVE|BLOCKED`), `active_subscription_count` (int ≥ 0), `creator_request_status` (`NONE|PENDING|REJECTED`), `joined_at` (ISO).
- `UserListResponseSchema`: `{ items, total, page, page_size }` (strict).
- `DEFAULT_USER_LIST_QUERY`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/user-list.ts`, `user-list.spec.ts` | query, row, response schemas |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:** defaults; each allowlist refuses an unknown value (sort, dir, status item, request item, range, page size 20, page 0, page "abc"); an unknown key is refused; `status=active,blocked` parses to two values and `status=` is refused; whitespace `q` → none, 101 chars refused; row / response schemas accept the documented shape and reject extra keys (no internal field such as `role`, `session_version`, `bio` can pass).

---

### TASK-099: `UserListService` (the projection)

`packages/backend-core/src/user-list/user-list.service.ts` (+ `index.ts`, export from `src/index.ts`):

```ts
class UserListService {
  constructor(prisma: PrismaClient, opts?: { clock?: () => Date })
  list(query: UserListQuery): Promise<UserListResponse>
}
```

- One parameterised query: `users u` with `role = 'USER'`, a `LEFT JOIN LATERAL` for the latest application (`ORDER BY created_at DESC, id DESC LIMIT 1`), and a correlated / grouped active-subscription count; outer `WHERE` for filters, `ORDER BY` from the fixed map plus the two tie-breakers, `LIMIT/OFFSET` from the validated page. `total` from a second query with the same `WHERE`. `subscriptions` sort orders by the count; `request` sort orders NONE < PENDING < REJECTED (fixed map).
- Mapping to the contract in one place (BigInt `telegram_id` → string, dates → ISO, `avatar_url` only when `https:`, latest `APPROVED` → `NONE`). Pick the `avatar_url` the same way as the creator list does (app photo, else Telegram photo).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/user-list/user-list.service.ts`, `user-list.service.int.spec.ts`, `index.ts` | projection |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL, `DATABASE_URL_TEST`):**
- Projection: only role USER rows; a CREATOR is absent; **approving a request removes the user from the list**; an ACTIVE and a BLOCKED user both appear with their status; admin accounts never appear.
- Request state: none → `NONE`; pending → `PENDING`; rejected → `REJECTED`; rejected then resubmitted (pending) → `PENDING`; two rejections → `REJECTED` once (one row per user, no duplicates from the join).
- Active count: counts only started, unexpired, non-revoked subscriptions; expired, revoked and **future** ones excluded; several creators add up.
- Filters change the result: `status` each combination, `request` each combination, `range` (injected clock, rows at 3 / 20 / 60 / 200 days), `q` by name, by Telegram id prefix, case-insensitivity, `%` / `_` treated literally.
- Sort: every allowlisted field in both directions on a dataset with ties (stable via tie-breakers).
- Pagination: pages 1..n disjoint and together equal the full ordered set; `total` independent of page; page past the end gives `[]` and the true total; sizes 10 / 25 / 50.
- Privacy: result keys equal the contract exactly (no role, bio, reason, application text, chat); SQL-injection-looking `q` is just a search string.

---

### TASK-100: `GET /v1/admin/users` and the admin client

- `apps/api/src/admin/users/` (module imports `AdminAuthModule` like `creators`; thin controller; `@UseGuards(CsrfGuard, AdminJwtGuard)`), `GET /v1/admin/users` validated with `UserListQuerySchema` through the existing Zod pipe (400 with the standard error contract), `Cache-Control: no-store`. Register in `AdminModule`.
- `apps/admin/src/auth/api-client.ts`: `listUsers(query)` builds the query string from the typed query (omits defaults), parses the response with `UserListResponseSchema`, supports `AbortSignal`, uses the existing one-renewal-then-retry behaviour. Add to the `AdminApi` interface.
- `apps/admin/test/fake-admin-api.ts`: `listUsers` with in-memory filtering / sorting / paging over fixtures, for component and visual tests only.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/admin/users/users.controller.ts`, `users.module.ts`, `tokens.ts` | endpoint |
| MODIFY | `apps/api/src/admin/admin.module.ts` | register |
| CREATE | `apps/api/test/admin-users.int.spec.ts` | integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client call |

**Testing (API integration, real app):** no cookie → 401; a **user Bearer token → 401**; valid admin session → 200 with `no-store`; filters, sort and pagination change the backend result over HTTP; every unknown sort / status / request / range / page size / extra key → 400 with the standard error body and request id; a CREATOR never appears after approval; response keys match the contract and contain no chat data; the endpoint never writes (row counts and audit unchanged). Client: query string omits defaults and encodes `q`; response validated; an aborted call rejects without touching state; one renewal then a retry.

---

### TASK-101: `/users` list page

`apps/admin/src/users/` + route `users` (replaces the placeholder; breadcrumb Dashboard › User; `/users/:id` stays a "belum dibangun" placeholder until US-018):

- **Toolbar** per `AdmUsers`: intro line "Hanya akun dengan role USER. Akun yang disetujui menjadi creator pindah ke daftar Creator." (verbatim), search "Cari nama atau Telegram ID" (debounced ~300 ms), **Status akun** (Semua / Active / Blocked), **Pengajuan creator** (Semua / Belum mengajukan / Menunggu / Ditolak), **Bergabung** (Semua / 7 hari terakhir / 30 hari terakhir / 90 hari terakhir: placeholder labels), **Reset Filter**.
- **Table** (`DataTable`): Pengguna (avatar or initials + name), Telegram (`@username` over `ID <telegram_id>`; "–" username when none), Status (`StatusChip`: Active = check, Blocked = user-off), Langganan aktif (the server count), Pengajuan creator (Belum mengajukan / Menunggu / Ditolak; icon + label, not colour alone), Bergabung (`13 Nov 2026`, Indonesian months, admin display zone), Aksi. Sortable headers: Pengguna, Telegram, Status, Langganan aktif, Pengajuan creator, Bergabung (default Bergabung ↓). Footer: "Menampilkan x–y dari n hasil" (Indonesian thousands separator), Baris per halaman 10/25/50, pager.
- **Row actions:** View (→ `/users/:id`, placeholder until US-018); Active rows show **Block**, Blocked rows **Unblock**: rendered per the board but **inert** (disabled, same placeholder tooltip as the creator list, no handler) until US-019.
- **State in the URL** (`useSearchParams`): `q`, `status`, `request`, `range`, `sort`, `dir`, `page`, `size`; defaults omitted; invalid hand-edited values fall back to defaults; any filter / search / size change resets `page` to 1; Reset Filter restores defaults; View then back (or reload) restores the same view. Older requests are cancelled; a page past the end moves to the last page.
- **States** per `AdmTableStates`: skeleton rows + "Memuat data…" while loading (toolbar stays interactive), "Belum ada data" when empty with no filters, "Tidak ada hasil" + Reset Filter when filtered, error + Retry on failure (generic text, never the thrown message).
- **Responsive:** 1440 per `AdmUsers`. Tablet (1024) and mobile (390) have **no boards**: reuse the creator list's treatment (identity + status columns on mobile, Filter button panel, horizontal scroll hint) and add "AdmUsers has no tablet/mobile board" to Known Gaps in `design-integration.md`.
- Applicant/user text rendered as text only (an `<img>` in a name creates no element).
- Share with the creator page only what is cheap: reuse `format.ts`, `useLayoutMode`, the debounce / URL-parse helpers (move to a shared file under `apps/admin/src/lists/` only if copying would duplicate them; do not refactor the creator page beyond that).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/users/UsersPage.tsx`, `users-page.module.css` | page |
| CREATE | `apps/admin/src/users/UsersToolbar.tsx`, `UserRowActions.tsx`, `useUserList.ts`, `list-url.ts`, `copy.ts` | toolbar, actions, data hook, URL <-> query, copy |
| MODIFY | `apps/admin/src/app/routes.tsx` | `/users` route, `/users/:id` placeholder |
| CREATE | `apps/admin/src/users/UsersPage.spec.tsx`, `list-url.spec.ts` | component tests |
| MODIFY | `visual/specs/visual.spec.ts` | `AdmUsers` at 1440 and the four `AdmTableStates` on `/users` |
| MODIFY | `.agile/guidelines/design-integration.md` | Known Gaps: users tablet/mobile, Bergabung presets |

**Testing:** component tests with the fake API: board copy and columns; Active shows Block, Blocked shows Unblock, both disabled with no calls; each filter, search, sort and page-size change sends the matching query and resets the page; the URL round-trips (reload and back keep filters; garbage URL → defaults); stale response ignored; loading, empty, no-results (Reset Filter works) and error + Retry; user text rendered as text; View links to `/users/<id>`; "1.262" style total formatting. Playwright at 1440 against `AdmUsers` (and `AdmTableStates`), reviewed side by side with the PNG (`refHeight` if the reference crop needs it). `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.

---

## Implementation order

TASK-098 → TASK-099 → TASK-100 → TASK-101 (rebuild `contracts` and `backend-core` before the API and admin see them).

## Open inputs

- **Tablet / mobile layouts** and the **Bergabung** options are not designed: placeholders flagged in Known Gaps.
- **Block / Unblock** are inert until US-019; `AdmUsersToastUnblock` belongs there.
- **View** lands on a placeholder until US-018 ships `/users/:id`.
- At story completion (dev-team): `codebase-map.md` (endpoint, admin route, inventory), QA reports, `completed.json`, `sprint.json`.
