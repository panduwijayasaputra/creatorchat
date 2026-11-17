# Technical Plan: US-014 — Admin creator list

## Architecture Overview

Agreed with the user (2026-11-16): Block / Unblock buttons are **rendered but inert** until US-016; the mobile **Filter** button opens a **simple panel flagged as a design gap**; the **Tanggal** filter offers **Semua / 7 / 30 / 90 hari** (placeholder copy).

One admin endpoint, one projection, one page:

```
GET /v1/admin/creators?q&status&type&range&sort&dir&page&page_size
  AdminJwtGuard ──▶ CreatorListService.list() (backend-core, one raw SQL projection)
                      PENDING creator_applications (applicant still a USER)  ─┐ UNION ALL
                      creators (ACTIVE / BLOCKED)                            ─┘
                    ──▶ { items, total, page, page_size }
/creators (admin)  ──▶ DataTable (packages/ui) + toolbar, state in the URL
   row actions: View → /creators/:id · Setujui/Tolak → US-012 dialogs · Block/Unblock inert (US-016)
```

- **A projection, not a table.** Rows are PENDING applications (labelled *Request*, the user is still `USER`) plus `Creator` accounts (*Active* / *Blocked*). Approved and rejected applications are never rows; a rejected request is never shown as Blocked. A user whose request was approved appears once, as a creator.
- **Server-side everything.** Search, filters, sort, pagination, totals and the "Menampilkan x–y dari n hasil" range come from the API; the UI never filters or slices. Sort fields and filter values are allowlisted; anything unknown is a 400.
- **Row identity.** Each row has `kind` (`request` | `creator`) and an `id`: the application id for a request, the creator id for an account. Both are UUIDs from different tables; `/creators/:id` (US-015) resolves either. Until US-015, View opens the existing "belum dibangun" placeholder at `/creators/:id`.
- **No private data.** The list returns identity, Telegram handle/id, Instagram, type, status, subscriber count and a date. No chat, media, reason text or internal admin ids.

Brief refs: §11 (Creator list, "Semua tabel"), §17. Design refs: `AdmCreators` (1440), `AdmCreatorsTablet` (1024), `AdmCreatorsMobile` (390), `AdmTableStates` (loading / empty / no results / error), `AdmCreatorsToastRej`, `AdmDlgApprove*`, `AdmDlgReject*` (over the list). Board map: `/creators`.

Out of scope: Block / Unblock behaviour and `AdmCreatorsToastUnblock` (US-016), the detail page (US-015), the User list (US-017).

## Authorization & Data Rules

- **Principal:** admin only (`AdminJwtGuard`; a user Bearer token is 401; no CSRF needed for GET). The response is `Cache-Control: no-store`.
- **Query contract** (`snake_case`, strict: an unknown key is a 400): `q` (trimmed, ≤ 100 chars, empty = none), `status` (comma list of `request|active|blocked`, default all three), `type` (`all|human|ai_character`, default all), `range` (`all|7d|30d|90d`, default all), `sort` (`name|telegram|type|status|subscribers|date`, default `date`), `dir` (`asc|desc`, default `desc`), `page` (≥ 1, ≤ 100 000), `page_size` (`10|25|50`, default 10). No `instagram` sort (the board has none).
- **Search:** case-insensitive "contains" on the display name (the requested name for a request) **or** prefix match on the Telegram id; `%`, `_` and `\` in `q` are escaped. Never string-built SQL: values are bound parameters; the ORDER BY column and direction come from a fixed map keyed by the allowlisted value.
- **Order is total:** the chosen sort, then `date desc`, then `id`, so pages never overlap or skip.
- **Subscriber count:** for a creator, subscriptions with `starts_at <= now < ends_at` and `revoked_at IS NULL`; `null` for a request. "Langganan aktif" (`has_active_subscription`) is true for a request row when the applicant, as a **customer**, has an active or future non-revoked subscription (the same rule that blocks approval).
- **Status values:** `REQUEST` (pending application), `ACTIVE`, `BLOCKED` (`creators.status`). The "Tanggal" is the request date for a request and the creator row's creation date for an account.
- **Page beyond the end** returns `items: []` with the real `total` (the UI then goes to the last page).
- **No writes** in this story's backend. The decision actions reuse the US-012 endpoints (admin id from the session, CSRF) unchanged.
- **Indexes:** none added (admin-sized data). `creators(status, created_at)` is a Phase H candidate if the list gets slow.
- **Events / outbox / sockets:** none.

## Dependencies

- Prior stories: US-012 (approve / reject dialogs, `useRequestReview`, `rejectedToast`, admin client), US-003 (admin session), US-002 (`DataTable`, `Select`, `StatusChip`, `Avatar`, `Toast` in `packages/ui`).
- No new packages. Seed: Maya (pending), Raka (pending + active subscription), Luna (pending), and 3 creators already exist; the boards' 19-row page is reproduced with test/preview fixtures, not seed data.

## Risks

- **Union query correctness** (a user listed twice, or a rejected request leaking as a row): integration tests cover approve → one row, reject → no row, resubmit → one request row.
- **Pagination drift when rows change between pages:** total order (sort, date, id) keeps pages stable for a fixed dataset; a decision made elsewhere simply changes the next fetch.
- **Mobile filter panel and Tanggal presets are undesigned:** built from existing components, flagged in `design-integration.md` Known Gaps for the designer.
- **Screenshot drift at tablet/mobile** (board font fallback offline, as in US-012): use `refHeight` where the reference crop needs it.
- **Stale rows after a decision:** the table refetches after every dialog outcome (approve, reject, already reviewed).

## Tasks

### TASK-081: Creator list contract

`packages/contracts/src/creator-list.ts` (+ `.spec.ts`, exported from `index.ts`):

- `CreatorListQuerySchema` (strict) parsing the query above from strings: `status` split on commas, de-duplicated, every item allowlisted (empty list → 400), `page` / `page_size` coerced from numeric strings with the stated bounds and the `10|25|50` set; defaults applied; `q` trimmed (an all-space `q` becomes none). Export the allowlists as constants (`CREATOR_LIST_SORT_FIELDS`, `CREATOR_LIST_PAGE_SIZES`, …) so the UI builds its options from them.
- `CreatorListRowSchema` (strict): `kind`, `id`, `status` (`REQUEST|ACTIVE|BLOCKED`), `creator_name`, `avatar_url` (https or null), `telegram_username` (nullable), `telegram_id` (string), `instagram_url` (nullable), `creator_type` (`HUMAN|AI_CHARACTER`), `subscriber_count` (int ≥ 0 or null), `has_active_subscription` (boolean), `date` (ISO).
- `CreatorListResponseSchema`: `{ items, total, page, page_size }` (strict).
- Pure helpers shared by API and UI: `instagramHandle` already exists in contracts (reuse); add `DEFAULT_CREATOR_LIST_QUERY`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-list.ts`, `creator-list.spec.ts` | query, row, response schemas |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:** defaults; each allowlist refuses an unknown value (sort, dir, status item, type, range, page size 20, page 0, page "abc"); an unknown key is refused; `status=request,active` parses to two values and `status=` is refused; whitespace `q` → none, 101 chars refused; row and response schemas accept the documented shape and reject extra keys (nothing internal leaks).

---

### TASK-082: `CreatorListService` (the projection)

`packages/backend-core/src/creator-list/creator-list.service.ts` (+ `index.ts`, export from `src/index.ts`):

```ts
class CreatorListService {
  constructor(prisma: PrismaClient, opts?: { clock?: () => Date })
  list(query: CreatorListQuery): Promise<CreatorListResponse>
}
```

- One parameterised query: a CTE `rows` = `UNION ALL` of the requests branch (PENDING applications joined to `users`) and the creators branch (`creators` joined to `users`, with the active-subscriber `count`), each already carrying the display columns; filters in an outer `WHERE`, `ORDER BY` from the fixed map plus the two tie-breakers, `LIMIT/OFFSET` from the validated page. `total` from a second query with the same `WHERE`. `range` compares the `Tanggal` column to `now - N days` using the injected clock.
- Mapping to the contract in one place (BigInt `telegram_id` → string, dates → ISO, `avatar_url` only when `https:`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-list/creator-list.service.ts`, `creator-list.service.int.spec.ts`, `index.ts` | projection |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL):**
- Projection: a pending request is a `REQUEST` row (counts null, `has_active_subscription` correct for a subscribed applicant, including a **future** subscription, and false for a revoked or expired one); an active and a blocked creator appear with their status; **approved and rejected applications are not rows**; a user who resubmits after a rejection has one request row; approving a request turns the row into one `ACTIVE` row (no duplicate).
- Subscriber count: counts only active, non-revoked, started subscriptions (expired, revoked and future ones are excluded).
- Filters change the result: each `status` combination, `type`, `range` (with an injected clock and rows at 3, 20, 60 and 200 days), `q` by name, by Telegram id prefix, a request's requested name, case-insensitivity, and `%` / `_` treated literally.
- Sort: every allowlisted field in both directions on a dataset with ties (stable via tie-breakers); `subscribers` puts requests (null) last in both directions.
- Pagination: pages 1..n are disjoint and together equal the full ordered set; `total` is independent of the page; a page past the end gives `[]` and the true total; page sizes 10 / 25 / 50.
- Privacy: result keys equal the contract exactly (no reason, no admin id, no chat); SQL-injection-looking `q` is just a search string.

---

### TASK-083: `GET /v1/admin/creators` and the admin client

- `apps/api/src/admin/creators/` (module imports `AdminAuthModule` like `creator-requests`; thin controller; `@UseGuards(AdminJwtGuard)`), `GET /v1/admin/creators` validated with `CreatorListQuerySchema` through the existing Zod pipe (400 with the standard error contract), `Cache-Control: no-store`. Register in `AdminModule`.
- `apps/admin/src/auth/api-client.ts`: `listCreators(query)` builds the query string from the typed query (omits defaults), parses the response with `CreatorListResponseSchema`, supports an `AbortSignal` so stale responses can be dropped, and uses the existing one-renewal-then-retry behaviour.
- `apps/admin/test/fake-admin-api.ts`: `listCreators` with in-memory filtering/sorting/paging over fixtures (it stands in for the server in component and visual tests only).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/admin/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | endpoint |
| MODIFY | `apps/api/src/admin/admin.module.ts` | register |
| CREATE | `apps/api/test/admin-creators.int.spec.ts` | integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client call |

**Testing (API integration, real app):** no cookie → 401; a **user Bearer token → 401**; a valid admin session → 200 with `no-store`; filters, sort and pagination change the backend result (the same assertions as the service test but over HTTP); every unknown sort / status / type / range / page size / extra key → 400 `VALIDATION_FAILED`-style error with the request id; response keys match the contract and contain no chat data; the endpoint never writes (row counts and audit unchanged). Client: query string omits defaults and encodes `q`; response validated; an aborted call rejects without touching state; one renewal then a retry.

---

### TASK-084: `/creators` list page (desktop, tablet, mobile)

`apps/admin/src/creators/` + route `creators` (replaces the placeholder; breadcrumb Dashboard › Creator):

- **Toolbar** per `AdmCreators`: search ("Cari nama atau Telegram ID", debounced ~300 ms), **Status** multi-select (Request / Active / Blocked; default all three, label "Request, Active, Blocked"), **Jenis** (Semua / Creator Asli / Karakter AI), **Tanggal** (Semua / 7 hari terakhir / 30 hari terakhir / 90 hari terakhir: placeholder labels), **Reset Filter**. The intro line ("Default menampilkan request menunggu serta creator Active dan Blocked. …") is copied verbatim from the board.
- **Table** (`DataTable`): columns Creator (avatar or initials + name), Telegram (`@username` over `ID <telegram_id>`), Instagram (`@handle`, "–" when none), Jenis (Creator Asli / Karakter AI), Status (`StatusChip`: Request = hourglass, Active = check, Blocked = user-off; "Langganan aktif" under the Request chip when `has_active_subscription`), Subscriber ("–" for requests), Tanggal (`14 Nov 2026`, Indonesian months, admin display zone), Aksi. Sortable headers: Creator, Telegram, Jenis, Status, Subscriber, Tanggal (default Tanggal ↓), sticky identity + action columns for scroll. Footer: "Menampilkan x–y dari n hasil", Baris per halaman 10/25/50, pager.
- **Row actions:** View (always, → `/creators/:id`; the route is a placeholder until US-015); Request rows show **Setujui** / **Tolak** (wired in TASK-085); Active rows show **Block**; Blocked rows show **Unblock**: rendered per the board but **inert** (disabled, `title="Tersedia di pembaruan berikutnya"`-style placeholder tooltip, no handler) until US-016.
- **State in the URL** (`useSearchParams`): `q`, `status`, `type`, `range`, `sort`, `dir`, `page`, `size`; defaults omitted; invalid values in a hand-edited URL fall back to defaults; any filter / search / size change resets `page` to 1; Reset Filter restores defaults; going to a detail page and back (or reload) restores the same view. Requests are cancelled when the URL changes again so a slow older response never overwrites a newer one; a page past the end moves to the last page.
- **States** per `AdmTableStates`: skeleton rows + "Memuat data…" while loading (keep the toolbar interactive), "Belum ada data" when empty with no filters, "Tidak ada hasil" + Reset Filter when filtered, error + Retry on failure (the error text is generic, never the thrown message).
- **Responsive:** 1440 (`AdmCreators`), 1024 (`AdmCreatorsTablet`), 390 (`AdmCreatorsMobile`: Creator + Status columns, "Filter" button, "Geser tabel ke samping untuk melihat seluruh kolom." hint, horizontal scroll). **Design gap:** the mobile Filter panel has no board: a plain panel/sheet with the same Status / Jenis / Tanggal controls and Reset, reusing desktop components; add it to Known Gaps in `design-integration.md`.
- A dev preview section with the review fixtures (as US-012) is not required; the page is rendered by the visual harness with the fake API.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/creators/CreatorsPage.tsx`, `creators-page.module.css` | page |
| CREATE | `apps/admin/src/creators/CreatorsToolbar.tsx`, `CreatorRowActions.tsx`, `useCreatorList.ts`, `list-url.ts` | toolbar, actions, data hook, URL <-> query |
| MODIFY | `apps/admin/src/creators/copy.ts` | list copy (verbatim from the boards; placeholders flagged) |
| MODIFY | `apps/admin/src/app/routes.tsx` | `/creators` route, `/creators/:id` placeholder |
| CREATE | `apps/admin/src/creators/CreatorsPage.spec.tsx`, `list-url.spec.ts` | component tests |
| MODIFY | `visual/specs/visual.spec.ts` | board screenshots |
| MODIFY | `.agile/guidelines/design-integration.md` | Known Gaps: mobile filter panel, Tanggal presets |

**Testing:** component tests with the fake API: the board copy and columns; a request row has Setujui / Tolak and "Langganan aktif" only when flagged; Active shows Block, Blocked shows Unblock, both disabled and without calls; each filter, search, sort and page-size change sends the matching query and resets the page; the URL round-trips (reload and back keep filters; a garbage URL falls back to defaults); stale response ignored; loading, empty, no-results (Reset Filter works) and error + Retry; applicant text rendered as text (an `<img>` name creates no element); View links to `/creators/<id>`. Playwright at 1440 / 1024 / 390 against `AdmCreators`, `AdmCreatorsTablet`, `AdmCreatorsMobile` and the four `AdmTableStates` cards (reviewed side by side with the PNGs; `refHeight` if the reference crop needs it). `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.

---

### TASK-085: Wire the approve / reject dialogs and the rejection toast

- **Setujui** opens `ApproveRequestDialog` and **Tolak** opens `RejectRequestDialog` (US-012, `apps/admin/src/creators/`) with that row's application id and name; the dialogs' own outcome callbacks drive the list:
  - approved → close, refetch the current view (the row becomes Active); success needs no toast (none is designed).
  - rejected → close, refetch, show the `rejectedToast` toast (`AdmCreatorsToastRej`); the row leaves the default filter only if the filter excludes requests, otherwise it simply is no longer a request row, as the server decides.
  - **already reviewed** (409) → refresh the list only, with no error; the row shows its current state.
  - cannot-approve and account-not-eligible answers stay inside the dialog as built in US-012.
- Only one dialog at a time; the trigger button regains focus on close; the list keeps its URL state across the decision; a refetch after a decision never resets the page unless it is now past the end.
- Toast: uses the existing `ToastProvider`; the copy is the board's (`rejectedToast`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/creators/CreatorsPage.tsx`, `CreatorRowActions.tsx`, `RequestTarget.tsx` (if the row needs adapting) | open dialogs, refetch, toast |
| MODIFY | `apps/admin/src/creators/CreatorsPage.spec.tsx`, `apps/admin/test/fake-admin-api.ts` | decision flows |
| MODIFY | `visual/specs/visual.spec.ts` | dialogs over the list, toast |
| MODIFY | `.agile/guidelines/codebase-map.md` | at story completion |

**Testing:** approve from the list → one approve call with the row id, dialog closes, list refetched and the row shows Active; reject with a reason → one reject call (reason trimmed, only the id), toast "…" per the board, list refetched; a 409 already-reviewed → refetch, no error and no toast; a blocked approval stays in the dialog; a double click sends one call; a decision keeps `q` / filters / page in the URL; focus returns to the trigger. Playwright: `AdmDlgApprove`, `AdmDlgApproveLoading`, `AdmDlgApproveFail`, `AdmDlgReject`, `AdmDlgRejectEmpty` over the list and `AdmCreatorsToastRej`, compared with the PNGs.

---

## Implementation order

TASK-081 → TASK-082 → TASK-083 → TASK-084 → TASK-085 (rebuild `contracts` and `backend-core` before the API and admin see them).

## Open inputs

- **Mobile Filter panel** and the **Tanggal** options are not designed: placeholders flagged in Known Gaps.
- **Block / Unblock** are inert until US-016; `AdmCreatorsToastUnblock` belongs there.
- **View** lands on a placeholder until US-015 ships `/creators/:id`.
- At story completion (dev-team): `codebase-map.md` (endpoint, admin route, inventory), QA reports, `completed.json`, `sprint.json`.
