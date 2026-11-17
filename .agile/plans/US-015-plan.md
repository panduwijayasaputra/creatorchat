# Technical Plan: US-015 — Admin creator detail (ringkasan and history)

> Task ids 091–097 (086–090 belong to US-016, 098–101 to US-017). Depends on US-016 being built first.

## Architecture Overview

Agreed with the user (2026-11-16): build the **Detail Log page** (`/logs/:id`, `AdmLogDetail`) now, so History's **View** works; the Log & History list tabs stay a placeholder until Phase G. An id of an **approved** application redirects to that creator's detail; a **rejected** application id is **not found** (rejections stay visible in History).

Three read endpoints, one detail page, one log page:

```
GET /v1/admin/creators/:id                → CreatorDetailService.get(id)   (creator id | application id)
GET /v1/admin/creators/:id/history?…      → CreatorHistoryService.list(id, query)   (audit rows about this person)
GET /v1/admin/audit-logs/:id              → AuditLogService.get(id)        (one audit row, safe projection)

/creators/:id            Ringkasan  (AdmCrReq | AdmCrActive | AdmCrBlocked | AdmCrApproved banner)
/creators/:id/history    History    (AdmCrHistory)        ── View ──▶ /logs/:id (AdmLogDetail)
/creators/:id/(subscribers|gallery|persona)  placeholders (Phases C, D, F)
```

- **One page for both kinds.** `/creators/:id` takes a creator id or the id of a PENDING application. The server resolves it and returns its canonical `id`; if that differs from the URL (an approved application), the page replaces the URL with the creator id. After approving from the header the page does the same and shows `AdmCrApproved` (`approvedBanner`).
- **Ringkasan has three variants:** request (`AdmCrReq`: "Deskripsi pengajuan" + "Pemeriksaan sebelum menyetujui"), active and blocked (`AdmCrActive` / `AdmCrBlocked`: four stat cards, bio/description, AI summary). Data that does not exist yet (conversations, messages, gallery media, AI usage) shows "–". The board's **Kategori** and **Kota** rows have no data model, so they are left out (not invented).
- **History is the audit trail of the person**: rows of `audit_logs` whose target is the person's user, any of their applications, or their creator row. Server-side search / filters / sort / paging; actions are labelled in Indonesian from a fixed map; nothing but allowlisted fields is ever returned.
- **Detail Log** shows one audit row: time with zone, actor, kind, target, status, summary, reason, request id, and the **before / after** values built from an allowlist (unknown keys never leave the server).
- **No new tables and no migration.** Read-only. **Order: US-016 is built before this story** (its block / unblock service, endpoints and `BlockCreatorDialog` / `UnblockCreatorDialog` exist), so the header **Block / Unblock** are live here (acceptance handed over from US-016) and a block shows `AdmCrBlockedDone`.

Brief refs: §11 (Creator detail, Log & History, "Semua tabel"), §6, §15 (no chat, no secrets in admin views). Design refs: `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked`, `AdmCrApproved`, `AdmCrHistory` (1440), `AdmLogDetail`, `AdmTableStates`; `AdmCrSubs` / `AdmCrGallery` / `AdmCrPersona` are only placeholders here. Route map: `/creators/:id` (tabs ringkasan, subscribers, gallery, persona, history), `/logs/:id`.

Out of scope: Block / Unblock behaviour itself (US-016), subscriber / gallery / persona tabs (Phases C, D, F), the Log & History list pages and filters (Phase G), the user detail page (US-018).

## Authorization & Data Rules

- **Principal:** admin only (`AdminJwtGuard`; a user token is 401). All three endpoints are GET, `Cache-Control: no-store`, and write nothing (not even an audit row for reading).
- **Id resolution** (`:id` is validated as a UUID, otherwise 404): creator id first; else an application id: `PENDING` → request detail, `APPROVED` → the creator row of that applicant (canonical id = creator id), `REJECTED` or no creator → 404. Never an error that tells which case it was.
- **Detail fields:** identity (name, avatar https only, `@username`, Telegram id), Instagram, type, status, `since` (submitted date for a request, creator creation date for an account). Request extras: description, the fixed "Dikonfirmasi" statement (a submitted request always has the rights confirmation), the applicant's current role, the active customer subscription block (same rule and helper as the approval check, `findSubscriptionBlock`: count, creator name, end date, active or future, not revoked) and the number of the applicant's **earlier rejected** applications. Creator extras: `public_code`, active subscriber count (started, not expired, not revoked), bio (`users.bio`), the approved application's description. No private chats, no media, no reasons of other people.
- **History scope:** `audit_logs` where `(target_type = 'user' AND target_id = person.user_id) OR (target_type = 'creator_application' AND target_id IN person's application ids) OR (target_type = 'creator' AND target_id = person.creator_id)`. The person is resolved from `:id` exactly as above (a rejected application id is 404 here too).
- **History query** (strict, snake_case, unknown key or value → 400): `q` (≤ 100, matches the action label, actor label or summary), `type` (`all|account|application|access`), `status` (`all|success|failed`), `sort` (`time|actor|action|status`, default `time`), `dir` (default `desc`), `page`, `page_size` (10/25/50). Order is the chosen sort, then time desc, then id. Search text is bound and LIKE-escaped; ORDER BY comes from a fixed map.
- **Labels (fixed map, fallback = the raw action):** `user.account.created` → "Bergabung" (Akun), `creator.application.submitted` → "Ajukan creator" (Pengajuan), `creator.application.approved` → "Setujui creator", `creator.application.rejected` → "Tolak creator" (Pengajuan), `user.role.changed` → "Ubah role" (Akses), `creator.blocked` / `creator.unblocked` (US-016) → "Block creator" / "Unblock creator" and `user.account.blocked` / `unblocked` → "Block user" / "Unblock user" (Akses), `user.login.blocked` → "Login diblokir" (Akun, status **Gagal**; every other action is **Berhasil**, since only completed actions are audited). Summary examples: "Akun USER dibuat via Telegram", "Permintaan dikirim", "Role USER → CREATOR", "Ditolak" (the reason is on the detail page, not in the table). Actor label: admin → the admin's username, user → their display name, system → "Sistem".
- **Audit detail** (`:id` UUID, else 404): never returns `changes` raw. Before / after lines come from an allowlist of keys (`role`, `status`, `display_name`, `subscriber_count`, ...) with fixed labels; a `[before, after]` pair fills both sides, `active_subscribers` (a number, written by US-016) is shown on both sides as "Subscriber aktif: n", any other key is dropped. `request_id` is shown as stored; `reason` as stored (admin-written, shown as text). No secrets or chat can be in an audit row by the existing write rules; the projection still drops everything not allowlisted.
- **Escaping:** applicant and reason text is rendered as text only.
- **Events / outbox / sockets:** none.

## Dependencies

- Prior stories: US-012 (dialogs, `approvedBanner`, `useRequestReview`, `findSubscriptionBlock`), US-014 (list, `DataTable` props, list-url pattern, `paletteFor`, fake list server), US-002 (shell, `Tabs`, `KvList`, `Card`, `StatusChip`), US-003 (admin session).
- No packages, no env, no migration. The audit log is written by US-003/005/010/012 flows; History is as rich as those events (no profile-change events exist yet).
- Shell: the topbar breadcrumb reads a static route `handle`; the detail pages need the person's name (`Dashboard / Creator / Salsa Maheswari / History`). TASK-095 adds a tiny `usePageCrumbs()` override (context set by the page, cleared on unmount).

## Risks

- **Leaking audit content:** mitigated by never returning `changes` raw (allowlist test with a poisoned `changes` row: secret-looking keys, nested objects, long strings) and by contract schemas that are strict.
- **History scope wrong (another person's events, or missing some):** integration tests with two people and cross-targets; a rejected application's events appear under the applicant.
- **Id confusion:** an application id of someone else's creator or a user id must never resolve to a creator: only the two tables above are consulted, and tests cover user ids, unknown ids, rejected and approved ids.
- **Dynamic breadcrumb touches the shell:** small, covered by the shell tests; routes without an override keep their static handle.
- **Design gaps:** History's **Jenis** options and the back-link text of Detail Log from a creator's History are not designed (placeholders flagged in Known Gaps); the board's Kategori / Kota rows are omitted.

## Tasks

### TASK-091: Creator detail, history and audit-log contracts

`packages/contracts/src/creator-detail.ts` (+ spec, exported):

- `CreatorDetailSchema` (strict): `kind` (`request|creator`), `id` (canonical), `status` (`REQUEST|ACTIVE|BLOCKED`), `creator_name`, `avatar_url` (https or null), `telegram_username`, `telegram_id`, `instagram_url`, `creator_type`, `since` (ISO), and either `request` = `{ id, description, user_role, previous_rejections, subscription_block: ApprovalBlock | null }` (kind `request`) or `creator` = `{ public_code, subscriber_count, bio: string | null, description: string | null }` (kind `creator`); a refinement ties each block to its kind. Response `{ creator: CreatorDetail, checked_at }` only for requests? (keep one shape: `{ detail, checked_at }`).
- `CreatorHistoryQuerySchema` (strict, as in the rules above, defaults applied) and `CreatorHistoryRowSchema` (`id`, `at`, `actor`, `action`, `summary`, `status`, `kind`), `CreatorHistoryResponseSchema` (`{ items, total, page, page_size }`).
- `AuditLogDetailSchema` (`id`, `at`, `actor`, `action`, `kind`, `target`, `status`, `summary`, `reason`, `request_id`, `before: {label,value}[]`, `after: {label,value}[]`).
- Constants for the allowlists and the Indonesian labels so API and UI share them.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-detail.ts`, `creator-detail.spec.ts` | schemas, allowlists, labels |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:** defaults; each allowlist refuses unknown values (sort, dir, type, status, page size, page, extra key, repeated key); detail kind/shape refinement (a request without `request`, a creator with both → refused); every schema is strict (extra key refused); avatar must be https.

---

### TASK-092: `CreatorDetailService`

`packages/backend-core/src/creator-detail/creator-detail.service.ts`:

```ts
class CreatorDetailService {
  constructor(prisma: PrismaClient, opts?: { clock?: () => Date })
  get(id: string): Promise<{ detail: CreatorDetail; checkedAt: Date } | null>   // null = not found
  resolve(id: string): Promise<ResolvedPerson | null>   // { userId, creatorId | null, applicationIds: string[], canonicalId }
}
```

- `resolve` implements the id rules (creator id → PENDING application → APPROVED application's creator → null) and returns every application id of that user (for History); History reuses it.
- `get` loads the user, the creator or the pending application, counts earlier REJECTED applications, calls `findSubscriptionBlock` (exported from `creator-request/subscription-block.js`) and counts active subscribers with the same rule as the list.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-detail/creator-detail.service.ts`, `.int.spec.ts`, `index.ts` | service |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration):** a pending request → `kind request` with description, role, `previous_rejections` 0, then 2 after two earlier rejections; a request whose applicant has an active or future subscription shows the block (count, creator, end date) and a revoked or expired one does not; a creator id → `kind creator` with status ACTIVE / BLOCKED, subscriber count (expired, revoked and future excluded), bio and the approved application's description (null for a seed creator); an **approved** application id resolves to the creator with `canonicalId` = creator id; a **rejected** application id, a user id, a random UUID and a malformed id → `null`; a user with a pending request and a creator row cannot happen (guarded), but a creator whose old application was approved resolves once; avatar `http:` dropped.

---

### TASK-093: `CreatorHistoryService` and `AuditLogService`

`packages/backend-core/src/creator-detail/`:

- `CreatorHistoryService.list(personId: string, query)` → `CreatorHistoryResponse | null` (null when the person does not resolve): one SQL over `audit_logs` with the scope rule, actor labels (join `admin_accounts` / `users`, "Sistem" for system), the fixed label / category / status / summary mapping in a CTE (`CASE` on `action`, fallback = raw action), filters and the same total-order sort pattern as the creator list.
- `AuditLogService.get(id)` → `AuditLogDetail | null`: the row, actor label, target label ("Citra Anindya (creator)": user → display name + "(user)" / "(creator)" when that user has a creator row, application → applicant name + "(pengajuan)", unknown → the target type), the same label map, and the allowlisted before / after builder (pure function `projectChanges(changes)` + spec).
- Shared pure module `audit-labels.ts` (action map, category, status, summary builder, field-label allowlist).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-detail/creator-history.service.ts`, `audit-log.service.ts`, `audit-labels.ts`, `audit-labels.spec.ts`, `creator-history.service.int.spec.ts`, `audit-log.service.int.spec.ts` | services and mapping |
| MODIFY | `packages/backend-core/src/creator-detail/index.ts` | export |

**Testing:**
- *History (integration):* only this person's events (two people, cross targets, another person's application never appears); a rejected application's events appear under its applicant; actor labels (admin username, user name, "Sistem"); `user.login.blocked` is **Gagal**, others **Berhasil**; filters `type` and `status` change the result; `q` matches label, actor and summary, case-insensitive, `% _ \` literal; every sort field both ways with ties stable; pages disjoint, `total` independent of the page, a page past the end empty; unknown person → `null`.
- *Audit detail (integration):* a row with a poisoned `changes` (`{ password: 'x', token: 'y', nested: {a: 1}, role: ['USER','CREATOR'], status: 'ACTIVE' }`) returns only the allowlisted lines (role before/after; the scalar and the secret-looking keys are dropped); reason and request id as stored; target labels for user, creator and application; unknown or malformed id → `null`; a row with `null` changes → empty before / after.
- *Pure mapping specs:* every known action maps to label, category, status and summary; unknown actions fall back safely.

---

### TASK-094: API endpoints and admin client

- `apps/api/src/admin/creators/creators.controller.ts` gains `GET :id` and `GET :id/history` (`@UseGuards(CsrfGuard, AdminJwtGuard)` already on the controller; `:id` validated; history query through the Zod pipe; `null` → `AppError 404 NOT_FOUND` with one generic message); a new `apps/api/src/admin/audit-logs/` module with `GET /v1/admin/audit-logs/:id`. All `no-store`.
- Providers for `CreatorDetailService`, `CreatorHistoryService`, `AuditLogService`.
- `apps/admin/src/auth/api-client.ts`: `getCreatorDetail(id, signal?)`, `listCreatorHistory(id, query, signal?)`, `getAuditLog(id, signal?)` with the same query-string helper pattern (defaults omitted), response validation, renewal and abort handling; `fake-admin-api.ts` stubs.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/admin/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | detail and history routes |
| CREATE | `apps/api/src/admin/audit-logs/audit-logs.controller.ts`, `audit-logs.module.ts` | log detail route |
| MODIFY | `apps/api/src/admin/admin.module.ts` | register |
| CREATE | `apps/api/test/admin-creator-detail.int.spec.ts` | integration test |
| MODIFY | `apps/admin/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/admin/test/fake-admin-api.ts` | client calls |

**Testing (API integration, real app):** no session and a Telegram user Bearer token → 401 on all three routes; detail 200 for a pending request, an active and a blocked creator (shape per contract); approved application id → 200 with the creator's canonical id; rejected application id, user id, unknown and malformed ids → 404 with the standard error body (identical message); history 200 with filters / sort / pages changing the backend result, and 400 for every unknown sort / type / status / page size / key; audit detail 200, poisoned `changes` never appears in the body, 404 for unknown / malformed; **no chat data or secrets** anywhere in the three bodies; no writes (row counts unchanged). Client: URL building (defaults omitted, ids encoded), validation, one renewal then retry, abort.

---

### TASK-095: Detail page: header, tabs, Ringkasan, not found

`apps/admin/src/creators/detail/` and routes `creators/:id`, `creators/:id/(subscribers|gallery|persona|history)`:

- **Shell:** `RouteHandle` breadcrumb override via `usePageCrumbs()` (`Dashboard / Creator / <name> [/ History]`), page title "Detail Creator".
- **Header card** (`AdmCrReq` / `AdmCrActive` / `AdmCrBlocked`): avatar or initials disc (72 px), name + `StatusChip`, line with `@username · ID`, Instagram handle, type, and "Diajukan 14 Nov 2026, 14.58 WIB" (request) or "Aktif sejak 21 Sep 2026" (creator; Blocked uses the Blocked board's wording), actions: request → **Setujui** / **Tolak** (wired in TASK-097), active → **Block**, blocked → **Unblock** (live: open the US-016 `BlockCreatorDialog` / `UnblockCreatorDialog`, TASK-097).
- **Tabs** (`Tabs`, links to the sub-routes): Ringkasan, Subscriber, Galeri, Persona AI, History. Subscriber / Galeri / Persona AI show the neutral "belum dibangun" panel.
- **Ringkasan, request:** "Deskripsi pengajuan" card (description, Nama creator, Instagram, Jenis creator, Pernyataan hak: "Dikonfirmasi: berhak mengelola identitas dan konten.") and "Pemeriksaan sebelum menyetujui" (Langganan pelanggan aktif: chip "Tidak ada" or the count with the block's creator and end date, Role saat ini, Riwayat pengajuan: "Pertama kali" or a placeholder "Ditolak N kali sebelumnya", and the info note from the board).
- **Ringkasan, active / blocked:** four stat cards (Subscriber aktif from the server; Percakapan, Pesan, Media galeri as "–"), "Bio dan deskripsi pengajuan" (bio, else the approved description, else "–"; Instagram row; no Kategori / Kota), "Ringkasan penggunaan AI" card with "–" values and an inert **Lihat Usage**.
- **States:** loading skeleton, not-found state for 404 (heading and a "Kembali ke daftar creator" link; no detail of why), error with retry, canonical-id redirect (`replace`).
- Applicant text rendered as text.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/creators/detail/CreatorDetailPage.tsx`, `DetailHeader.tsx`, `RequestSummary.tsx`, `CreatorSummary.tsx`, `useCreatorDetail.ts`, `creator-detail.module.css` | page |
| MODIFY | `apps/admin/src/creators/copy.ts` | board copy (placeholders flagged) |
| MODIFY | `apps/admin/src/components/shell/route-handle.ts`, `Topbar.tsx`, `AdminShell.tsx` | crumb override |
| MODIFY | `apps/admin/src/app/routes.tsx` | routes |
| CREATE | `apps/admin/src/creators/detail/CreatorDetailPage.spec.tsx` | component tests |
| MODIFY | `visual/specs/visual.spec.ts`, `apps/admin/test/creator-list-fixtures.ts` (detail fixtures) | screenshots |

**Testing:** component tests for the three Ringkasan variants (board copy, the subscription chip "Tidak ada" vs count, "Pertama kali" vs earlier rejections, stat cards "–", no Kategori / Kota), tabs navigate by URL and the placeholders show, not-found for 404, error + retry, canonical id replaces the URL, breadcrumb shows the name, text rendered as text. Playwright at 1440 px: `AdmCrReq`, `AdmCrActive`, `AdmCrBlocked` (page content next to each board's `main`).

---

### TASK-096: History tab and Detail Log page

- **History** (`/creators/:id/history`, `AdmCrHistory`): `DataTable` with columns Waktu (`9 Nov 2026, 10.12` WIB), Aktor, Tindakan, Ringkasan, Status (`StatusChip` Berhasil / Gagal), Aksi (**View** → `/logs/:id`, passing `from` in the router state); toolbar "Cari tindakan", Jenis (Semua / Akun / Pengajuan / Akses: placeholder labels, **design gap**), Status (Semua / Berhasil / Gagal), Reset Filter; default sort Waktu ↓; filters, sort and page live in the URL (`q`, `type`, `status`, `sort`, `dir`, `page`, `page_size`), same patterns as the list (`list-url`, `useLatest` abort handling, state boards).
- **Detail Log** (`/logs/:id`, `AdmLogDetail`): "Kembali ..." link, "Ringkasan kejadian" card (Waktu lengkap with zone "13 Nov 2026, 11.20.18 WIB (UTC+7)", Aktor, Jenis, Target, Status chip, Ringkasan, Alasan when present, Request ID in monospace), "Nilai sebelum dan sesudah" card (SEBELUM / SESUDAH panels, the privacy note) and the footer note "Entri audit tidak bisa diubah atau dihapus." Back link: to the page the person came from (router state) with the board text when it came from the audit list and a placeholder "Kembali ke History Creator" from a creator's History (**design gap**), else `/logs`. Not-found and error states; breadcrumb `Dashboard / Log & History / Detail Log`. The `/logs` and `/logs/*` list tabs remain the placeholder.
- Add the two gaps (History Jenis options, the back-link wording) to `design-integration.md` Known Gaps.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/creators/detail/HistoryTab.tsx`, `history-url.ts`, `history-url.spec.ts`, `useCreatorHistory.ts` | history table |
| CREATE | `apps/admin/src/logs/LogDetailPage.tsx`, `log-detail.module.css`, `LogDetailPage.spec.tsx` | Detail Log |
| MODIFY | `apps/admin/src/app/routes.tsx`, `copy.ts`, `.agile/guidelines/design-integration.md` | routes, copy, gaps |
| MODIFY | `visual/specs/visual.spec.ts` | screenshots |

**Testing:** History component tests (columns and copy, View links with `from`, every filter / search / sort / page-size change sends its value and resets the page, URL round trip and garbage fallback, stale response ignored, loading / empty / no-results / error states, Berhasil / Gagal chips, actor and summary rendered as text); Detail Log tests (all rows and the before / after panels, reason hidden when absent, request id monospace, 404 and error, back link target from router state and fallback, text rendered as text). Playwright at 1440 px: `AdmCrHistory` and `AdmLogDetail`.

---

### TASK-097: Header actions: dialogs, `AdmCrApproved`, row links

- Header **Setujui** / **Tolak** open `ApproveRequestDialog` / `RejectRequestDialog` with the request's application id (the `request.id` of the detail, not the URL id).
  - **Approved** → close, refetch with the creator id, replace the URL with `/creators/<creator id>` (the response carries `creator.id`), show the `AdmCrApproved` toast (`approvedBanner`: "Maya Lestari kini Creator Active") and the Active header and Ringkasan (stat cards 0 / "Belum diatur" wording per the board where data exists: Subscriber aktif 0; the other cards "–").
  - **Rejected** → close, toast `rejectedToast`, and navigate to `/creators` (the request is no longer a row or a detail), keeping the list's saved URL state when the person came from it.
  - **Already reviewed** → refetch only: an approved request redirects to the creator, a rejected one shows the not-found state.
- The list's row **View** already links to `/creators/:id`; check that going back from the detail restores the list view (URL state).
- **Block / Unblock (handed over from US-016):** the header buttons open `BlockCreatorDialog` / `UnblockCreatorDialog` with the creator id. A successful **block** refetches and shows `AdmCrBlockedDone` (the Blocked header and Ringkasan, per the board); a successful **unblock** refetches and shows the Active page with the `kembali Active` toast; a 409 `CREATOR_STATUS_CONFLICT` only refetches. The list's rows use the same dialogs (US-016), so the two screens stay consistent.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/creators/detail/CreatorDetailPage.tsx`, `DetailHeader.tsx` | dialogs, banner, redirect |
| MODIFY | `apps/admin/src/creators/detail/CreatorDetailPage.spec.tsx`, `apps/admin/test/fake-admin-api.ts` | flows |
| MODIFY | `visual/specs/visual.spec.ts` | `AdmCrApproved` |
| MODIFY | `.agile/guidelines/codebase-map.md` | at story completion |

**Testing:** block from an Active header → dialog → `AdmCrBlockedDone` with the Blocked header; unblock → Active header and toast; a 409 conflict only refetches; approve from the header → one call with the application id, URL becomes the creator id, banner text and Active header; double click one call; blocked approval stays in the dialog; reject → toast and list navigation; already-reviewed approved → creator page, rejected → not found; opening the page from a list row and pressing back keeps the list filters. Playwright: `AdmCrApproved` (toast and Active header) and `AdmCrBlockedDone`.

---

## Implementation order

TASK-091 → TASK-092 → TASK-093 → TASK-094 → TASK-095 → TASK-096 → TASK-097 (rebuild `contracts` and `backend-core` before the API and admin see them).

## Open inputs

- **History "Jenis" options** (Akun / Pengajuan / Akses) and the **Detail Log back-link wording** from a creator's History are not designed: placeholders flagged in Known Gaps. The board's **Kategori / Kota** rows have no data model and are omitted.
- Subscriber / Galeri / Persona AI tabs are placeholders (Phases C, D, F); the Log & History list is Phase G.
- History only shows events that are audited today (joined, applied, approved / rejected, role changed, blocked login); profile changes and blocks appear once those flows write audit rows.
- At story completion (dev-team): `codebase-map.md` (endpoints, routes, inventory), QA reports, `completed.json`, `sprint.json`.
