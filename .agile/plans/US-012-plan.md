# Technical Plan: US-012 — Admin approves or rejects a creator request

## Architecture Overview

Agreed with the user (2026-11-16, all three recommended options):

1. **Backend complete, dialogs now, wiring later.** The decision flow (transaction, API, outbox write) is built and tested end to end. The four dialogs (`AdmDlgApprove`, `AdmDlgApproveLoading`, `AdmDlgApproveFail`, `AdmDlgReject`, `AdmDlgRejectEmpty`) and an admin API client are built as components and checked in `/__preview` and against the board PNGs. They are **not reachable from a real page** until US-014 (list row buttons, `AdmCreatorsToastRej`) and US-015 (detail header, `AdmCrApproved`) exist. The wiring is added to those stories as acceptance criteria (Task 5 step). Consequence for UAT: until then an admin can only decide through the API; the story is "backend complete, UI components built, not wired".
2. **`Creator` row carries the request's data.** `creators` gains `creator_type` (NOT NULL, default `HUMAN`, so existing and seed creators stay valid) and `instagram_url` (nullable), copied from the request on approval. Matches the brief's data model (Creator has type) and gives the US-014 list a plain join.
3. **Approval copies the requested name into `users.display_name`** (the creator's public name is that column since US-008). The change is part of the audit entry (`display_name: [old, new]`); the creator can edit it later in Pengaturan.

Defaults taken without asking (say so if you disagree):
- **The outbox table is created here, the dispatcher is not.** US-012 adds `outbox_events` and a write-only `OutboxService.add(tx, …)`; the decision transaction writes one event with a unique dedupe key. The dispatcher, reconciler, queue and the bot send are US-013. Until US-013 the events stay `PENDING` and **no Telegram message is sent**.
- **Endpoints address the application id** (`/v1/admin/creator-requests/:id`), never a user id. `GET` gives the dialogs the identity box and the "Diperiksa ulang" line; US-015 can extend it for "Pemeriksaan sebelum menyetujui".
- **Opening the approve dialog does a pre-check.** If the pre-check already finds a blocking subscription the dialog opens directly in the `AdmDlgApproveFail` state; the confirm call re-checks inside the transaction and answers 409 with the same details for the race case. Both paths render the same board.
- **Reject is allowed for any PENDING request**, including a BLOCKED applicant (it clears the queue). Approve needs an ACTIVE USER.
- **Seed:** Raka Putra gets a PENDING request (board: three pending, Raka blocked by his subscription). Side effect: his Profile now shows `ProfilePending` (pending beats blocked), so the US-010 blocked screens are no longer reachable for Raka in the seed.
- Admin times are shown in WIB (`Asia/Jakarta`), as the boards do; there is no admin timezone setting.

Brief refs: §3, §5 (transactional re-check; future access must be resolved first), §11, §13 (`OutboxEvent`, `AuditLog`), §14, §15, §17. Design refs: `AdmDlgApprove`, `AdmDlgApproveLoading`, `AdmDlgApproveFail`, `AdmDlgReject`, `AdmDlgRejectEmpty` (all drawn over the `AdmCreators` list at 1440×1040; only the dialog card is compared), `AdmCrApproved` and `AdmCreatorsToastRej` (host-page states, wired by US-015 / US-014).

Slice: contracts → schema + seed + outbox writer → domain service (+ a transaction-aware `AccountSecurityService`) → admin endpoints → admin dialogs and client.

Not built (by design): the admin list and detail pages (US-014/015), the dispatcher / worker / bot message (US-013), the Mini App has no change (an approved user's stale session is already handled by US-006; this story adds the end-to-end test).

## Authorization & Data Rules

- **Who:** only an authenticated admin (`@UseGuards(CsrfGuard, AdminJwtGuard)`, cookie + `Origin` + `X-CSRF-Token`). A Telegram user token answers 401. The admin id comes from the session (`@CurrentAdmin()`), never from the body.
- **IDs:** `:id` is a `creator_applications.id`. Unknown or malformed → 404 `NOT_FOUND`. No user id, role or status is read from the client; a body on approve is ignored; the reject body is `{ reason }` only (other keys stripped).
- **One transaction per decision, fixed lock order** (the same order the submit uses, so no deadlock): read the application's `user_id`, `SELECT … FOR UPDATE` the **user row**, then `SELECT … FOR UPDATE` the **application row**, then re-check.
- **Approve re-checks, in this order:** application still `PENDING` (else 409 `CREATOR_REQUEST_ALREADY_REVIEWED` with the current status); user `ACTIVE` and role `USER` (else 409 `CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE`); no subscription with `revoked_at IS NULL AND ends_at > now` — active **or future** (else 409 `CREATOR_APPROVAL_BLOCKED`, `details` = `{ count, creator_name, ends_at }` of the one that ends last; nothing written).
- **Approve writes (same transaction):** application → `APPROVED` (`reviewed_by_admin_id`, `reviewed_at`, no reason); role → `CREATOR` through the transaction-aware `AccountSecurityService` (bumps `session_version`, revokes the user's sessions, writes `user.role.changed`); `users.display_name = creator_name`; `Creator` row (`user_id`, `public_code`, `creator_type`, `instagram_url`, status ACTIVE); audit `creator.application.approved`; one outbox event.
- **Public code:** `generatePublicCode()`; inserted with `INSERT … ON CONFLICT (public_code) DO NOTHING RETURNING` in a bounded loop (5 tries), because a failed plain insert would abort the Postgres transaction. A user who already has a `creators` row (cannot happen for a USER) surfaces as an unexpected error and rolls everything back.
- **Reject writes:** application → `REJECTED` (admin, time, reason — the DB CHECK already demands the reason); role stays `USER`; audit `creator.application.rejected` with the reason; one outbox event. Reason: trimmed, 1–300 code points, no control characters except newline; empty → 400 `VALIDATION_FAILED` ("Alasan wajib diisi.", the board's text), also enforced by the server.
- **Double submit / two admins:** the lock serialises them; the loser sees a non-PENDING row and gets 409 `CREATOR_REQUEST_ALREADY_REVIEWED` with the status that won. Exactly one outbox event exists per application (`dedupe_key = creator_application:<id>:decision`, UNIQUE, `ON CONFLICT DO NOTHING`).
- **Outbox payload holds ids only** (`application_id`, `user_id`, `decision`) — never the reason or text; the US-013 worker reads the current row at send time.
- **Rejection reason is admin text**: rendered as plain text everywhere (already the case in the Mini App); never logged.
- **Stale sessions:** after approval the user's old token fails the revocation and `session_version` checks (401); a new login returns the same user id with `role: CREATOR`; `GET /v1/creators/by-code/<new code>` then resolves for a customer (the creator is ACTIVE and shows the requested name).
- **Phase C note:** subscription grant must lock the user row and refuse role CREATOR, otherwise a grant could slip in between this re-check and the commit.

## Dependencies

- No new packages. Prior stories: US-003 (admin guards), US-006 (`AccountSecurityService`), US-010/011 (applications, subscriptions, `findBlock`), US-005 (`generatePublicCode`, `creators`).
- Env vars: none. Run `pnpm db:migrate` on the dev database for the new migration.
- Next free task ids: TASK-071…075 (checked against `.agile/features`).

## Risks

- **Nested transaction in `AccountSecurityService`:** its methods open their own `$transaction`, which cannot join the approval's. Mitigation: add `…InTransaction(tx, …)` variants that hold the existing body; the public methods call them inside `$transaction`, so US-006 behaviour and tests are unchanged.
- **Lock ordering / deadlock:** user row first, application second, everywhere (`submit` only takes the user row). Covered by a concurrent-decision test.
- **Unique `public_code` conflict inside a transaction:** `ON CONFLICT DO NOTHING` loop (above); test with an injected generator that collides first.
- **No bot message yet:** the outbox events stay `PENDING` until US-013; stated in the UAT notes so nobody expects the Telegram message.
- **UI unreachable until US-014/015:** dialogs are verified in `/__preview` and by component tests with a fake API; the real flow is covered by API integration tests. The acceptance items about row buttons, the rejection toast and `AdmCrApproved` are explicitly moved to US-014/015.
- **Existing dev DB:** the migration adds `creator_type` with a default and a nullable `instagram_url`, so the three seed creators keep working (the seed does not touch existing rows; their Instagram stays empty until the seed DB is recreated).
- **Seed change for Raka Putra** (above) alters the US-010 UAT path; recorded in the decisions log.

## Tasks

### TASK-071: Contracts for the review flow

`packages/contracts/src/creator-review.ts` (export from `index.ts`), `errors.ts`, plus specs.

- Error codes (add to `ErrorCode`): `CREATOR_REQUEST_ALREADY_REVIEWED` (409, `details: { status: 'APPROVED' | 'REJECTED' }`), `CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE` (409), `CREATOR_APPROVAL_BLOCKED` (409, `details: ApprovalBlock`).
- `ApprovalBlockSchema = strictObject({ count: int ≥ 1, creator_name: string, ends_at: string })`.
- `AdminCreatorRequestSchema = strictObject({ id, status, creator_name, instagram_url, creator_type, description, created_at, reviewed_at, review_reason, user: strictObject({ id, display_name, telegram_username: string | null, telegram_id: string, role, status }) })`.
- `CreatorRequestReviewResponseSchema = strictObject({ request: AdminCreatorRequestSchema, check: strictObject({ block: ApprovalBlockSchema.nullable(), checked_at: string }) })` — `GET` response.
- `RejectCreatorRequestSchema` (plain `object`, other keys stripped): `reason` → trim, `\r\n` normalised, 1–300 code points (`codePointLength`), no control characters except newline. Messages: `REJECT_REASON_REQUIRED = 'Alasan wajib diisi.'` (verbatim from `AdmDlgRejectEmpty`), `REJECT_REASON_TOO_LONG` (placeholder wording), `REJECT_REASON_INVALID` (placeholder).
- `ApproveCreatorRequestResponseSchema = strictObject({ request: AdminCreatorRequestSchema, creator: strictObject({ id, public_code }) })`; `RejectCreatorRequestResponseSchema = strictObject({ request: AdminCreatorRequestSchema })`.
- Path constants: `ADMIN_CREATOR_REQUESTS_PATH = '/v1/admin/creator-requests'`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-review.ts`, `creator-review.spec.ts` | schemas, copy, paths |
| MODIFY | `packages/contracts/src/errors.ts`, `errors.spec.ts`, `index.ts` | three error codes, export |

**Testing:** reason trimmed / empty / whitespace-only / 300 vs 301 code points (emoji counted once) / control characters / newline allowed / extra keys stripped; response schemas reject unknown keys (nothing like `user_id` leaks beyond `user.id`); error codes are unique strings.

---

### TASK-072: Schema, migration, seed and the outbox writer

Migration `20261120010000_creator_review_outbox` (SQL checked into the repo):
- `creators.creator_type "CreatorType" NOT NULL DEFAULT 'HUMAN'`, `creators.instagram_url TEXT NULL`.
- Enum `OutboxEventStatus { PENDING, DONE }` (US-013 may add values additively) and table `outbox_events`: `id uuid pk default gen_random_uuid()`, `type text`, `aggregate_type text`, `aggregate_id uuid`, `payload jsonb`, `dedupe_key text UNIQUE`, `status OutboxEventStatus default PENDING`, `available_at timestamptz(3) default now()`, `attempts int default 0`, `processed_at timestamptz(3) null`, `created_at timestamptz(3) default now()`; index `(status, available_at)`.
- Prisma models `OutboxEvent` and the two `Creator` fields; `pnpm db:generate`.

`packages/backend-core/src/outbox/outbox.service.ts`: `OutboxService.add(tx, { type, aggregateType, aggregateId, payload, dedupeKey }): Promise<{ created: boolean }>` — `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`; write-only (no dispatcher). Event types as constants: `creator_application.approved`, `creator_application.rejected`. Payload validated to be a flat object of ids/strings (no free text) by a small guard.

Seed: `UserFixture`/creator fixtures get `creatorType` and `instagramUrl` (Salsa `https://instagram.com/salsa.maheswari`, Kirana `https://instagram.com/kirana.larasati`, Dinda `https://instagram.com/dinda.prameswari`; types from the board); `run-seed.ts` sets them only when it creates a `creators` row. `APPLICATION_FIXTURES` gains Raka Putra (`9_000_000_012n`): PENDING, "Raka Putra", `https://instagram.com/raka.kitchen`, `HUMAN`, a short description. Idempotency unchanged; `seed.int.spec.ts` updated (three applications: Maya pending, Raka pending, Luna rejected).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/20261120010000_creator_review_outbox/migration.sql` | columns, enum, table, index |
| MODIFY | `packages/db/prisma/schema.prisma` | `Creator` fields, `OutboxEvent`, enum |
| CREATE | `packages/backend-core/src/outbox/outbox.service.ts`, `index.ts`, `outbox.service.int.spec.ts` | write-only outbox |
| MODIFY | `packages/backend-core/src/index.ts` | export |
| MODIFY | `packages/db/seed/fixtures.ts`, `run-seed.ts`, `seed.int.spec.ts` | creator data, Raka's request |

**Testing:** migration applies on a database that already has creators (defaults hold); `add` twice with one dedupe key leaves one row and reports `created: false` the second time; two concurrent `add`s leave one row; a free-text payload is refused; seed runs twice with the expected counts and Raka has one PENDING request.

---

### TASK-073: `CreatorApprovalService` (+ transaction-aware `AccountSecurityService`)

`AccountSecurityService`: move the body of `change` into `changeInTransaction(tx, userId, context, action, decide)`; add public `changeRoleInTransaction(tx, userId, role, context)` (and the status variants for symmetry); the existing public methods keep their signatures and wrap the new ones in `$transaction`. Existing specs pass unchanged.

`packages/backend-core/src/creator-review/creator-approval.service.ts`:
```ts
class CreatorApprovalService {
  constructor(prisma, security: AccountSecurityService, opts?: { clock?, generateCode? })
  getForReview(id): Promise<{ request: AdminCreatorRequest; check: { block: ApprovalBlock | null; checkedAt: Date } } | null>
  approve(id, ctx: { adminId; requestId? }): Promise<ApproveOutcome>
  reject(id, reason, ctx: { adminId; requestId? }): Promise<RejectOutcome>
}
// ApproveOutcome: ok{request, creator} | not_found | already_reviewed{status} | not_eligible | blocked{block}
// RejectOutcome:  ok{request} | not_found | already_reviewed{status}
```
- `findBlock` from `creator-request.service.ts` is extracted into a shared helper that also returns the `count` (US-010 keeps using the same rule and ignores the count).
- `approve` / `reject` follow the lock order and writes in "Authorization & Data Rules". `getForReview` is a read (no lock) used for the pre-check; the transaction re-checks.
- Mapping to `AdminCreatorRequest` is explicit (no Prisma model leaves the service).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/account-security/account-security.service.ts` | `…InTransaction` variants |
| MODIFY | `packages/backend-core/src/creator-request/creator-request.service.ts` | shared block helper with count |
| CREATE | `packages/backend-core/src/creator-review/creator-approval.service.ts`, `index.ts`, `creator-approval.service.int.spec.ts` | the flow |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real PostgreSQL):**
- Approve converts the **same** account (user id and Telegram id unchanged): role CREATOR, `session_version` +1, sessions revoked, `creators` row with type/Instagram/valid public code, `display_name = creator_name`, application APPROVED with admin and time, audit rows (`creator.application.approved` with the display-name change, `user.role.changed`), exactly one outbox event.
- Reject: REJECTED with reason/admin/time, role stays USER, session untouched, audit with reason, one outbox event.
- Refused with nothing written: unknown id; already APPROVED / REJECTED; BLOCKED account; role already CREATOR; active subscription; **future** subscription (conflict); an ended or revoked subscription does not block.
- Concurrency: two simultaneous approves → one `ok`, one `already_reviewed`, one creator row, one outbox event; approve vs reject at once → one wins; approve vs a concurrent `submit` of the same user serialises.
- `public_code` collision: an injected generator that returns an existing code first → approval still succeeds with the next code.
- Rollback: a failure after the role change (injected, e.g. outbox failure) leaves the application PENDING and the role USER.
- A pending / rejected request never changes the role.

---

### TASK-074: Admin endpoints

`apps/api/src/admin/creator-requests/` (`creator-requests.module.ts`, `creator-requests.controller.ts`; import `AdminAuthModule`; register in `AdminModule`):

| Method | Route | Guard | Behaviour |
|---|---|---|---|
| GET | `/v1/admin/creator-requests/:id` | `CsrfGuard`, `AdminJwtGuard` | `CreatorRequestReviewResponse`; 404 unknown/malformed |
| POST | `/v1/admin/creator-requests/:id/approve` | same | 200 `ApproveCreatorRequestResponse`; 404 / 409 codes above |
| POST | `/v1/admin/creator-requests/:id/reject` | same | body `RejectCreatorRequestSchema`; 200 `RejectCreatorRequestResponse`; 400 empty reason; 404 / 409 |

Thin controller: validates (`ZodValidationPipe`, `:id` as uuid), calls the service with `@CurrentAdmin()` id and `request.id`, maps outcomes to `AppError` (`ALREADY_REVIEWED` carries `{status}`, `APPROVAL_BLOCKED` carries the block). All responses `Cache-Control: no-store` (already set for `/v1/admin`). The service is provided as a Nest provider next to `AccountSecurityService`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/admin/creator-requests/creator-requests.controller.ts`, `creator-requests.module.ts` | endpoints |
| MODIFY | `apps/api/src/admin/admin.module.ts` | register |
| CREATE | `apps/api/test/creator-requests.int.spec.ts` | API tests |

**Testing (integration, `buildTestApp`):** admin cookie + CSRF happy path for GET / approve / reject; **no cookie, a Telegram user token, a garbage token and a missing CSRF header → 401 / 403 and nothing changes**; unknown and malformed ids → 404; empty and whitespace reason → 400 with the board message in `details`, nothing changes; 409 bodies carry the documented `details` (blocked: creator name and end date from the server — Raka's seed shape); double approve and approve + reject at once → one wins; a rejected request never changes the role; **approval converts the same account**: the old user token then answers 401 on `/v1/me`, a new `/v1/auth/telegram` login returns the same user id with role `CREATOR`, and `GET /v1/creators/by-code/<code>` answers 200 for a customer with the requested name; a blocked applicant's request can be rejected but not approved; audit rows and one outbox event exist; responses never contain a password hash, token or `reviewed_by_admin_id`. `roles-declared.spec.ts` still passes (admin routes are outside user scope).

---

### TASK-075: Admin API client and review dialogs

Admin app only (no route, no page):
- `apps/admin/src/auth/api-client.ts` (or a sibling that reuses its single-flight refresh pipeline): `getCreatorRequest(id)`, `approveCreatorRequest(id)`, `rejectCreatorRequest(id, reason)`, parsed with the contract schemas; `ApiError` keeps `code` and `details`.
- `packages/ui` `ConfirmDialog`: additive `confirmDisabled?: boolean` (used by the fail state) with its spec; nothing else changes for existing callers.
- `apps/admin/src/creators/ApproveRequestDialog.tsx` and `RejectRequestDialog.tsx` (+ specs), props `{ requestId, open, api, onClose, onDecided }`, copy verbatim from the boards (title "Setujui permintaan creator?" / "Tolak permintaan creator?", target box with initials, name, `@username · ID … · Creator Asli|Karakter AI` and the "Request" chip, the CREATOR emphasis text, "Diperiksa ulang: tidak ada langganan pelanggan aktif (HH.mm WIB)", the bot/audit note, "Batal", "Setujui Creator", "Memproses…", "Tolak Permintaan", "Alasan penolakan (wajib)", "Alasan dicatat di audit log.", "Alasan wajib diisi.").
  - Open → load the request (skeleton, failure + retry). Pre-check with a block → opens in the **fail** state: chip "Tidak bisa disetujui", "Akun ini masih memiliki N langganan pelanggan aktif: <creator>, hingga <d MMM yyyy>. Permintaan dapat disetujui setelah seluruh langganan berakhir.", "Kamu masih bisa menolak permintaan dengan alasan.", **Setujui Creator** disabled.
  - Confirm → busy ("Memproses…", every close path disabled, double click fires once); 409 `CREATOR_APPROVAL_BLOCKED` → fail state with the server's details; 409 `CREATOR_REQUEST_ALREADY_REVIEWED` → close and report `onDecided({ kind: 'already_reviewed', status })`; success → `onDecided({ kind: 'approved' | 'rejected', request })`; other errors → the dialog's inline failure message (the thrown message is never shown).
  - Reject: empty/whitespace reason shows the inline "Alasan wajib diisi." (client check with the shared schema; the server enforces it too), the typed reason is kept on failure.
- Copy for the host pages is exported from `apps/admin/src/creators/copy.ts` for US-014/015 (`Permintaan {nama} ditolak dan dicatat`, `{nama} kini Creator Active`) so the wording lives once.
- `/__preview` gets a section per dialog state (`data-preview-section`) using a fake API; Playwright items `admin-dlg-approve`, `admin-dlg-approve-loading`, `admin-dlg-approve-fail`, `admin-dlg-reject`, `admin-dlg-reject-empty` at 1440, comparing **only the dialog card** against the board (the list behind the backdrop is US-014). Each sheet reviewed side by side with its PNG.
- **Story bookkeeping:** append acceptance bullets to US-014 (row **Setujui**/**Tolak** open these dialogs; after a rejection the list shows the toast and the row leaves the default filter; after an approval the row becomes Active) and US-015 (header Setujui/Tolak open the dialogs; after approval the page shows `AdmCrApproved` "… kini Creator Active"; "Pemeriksaan sebelum menyetujui" extends `GET /v1/admin/creator-requests/:id`).
- At story completion (dev-team): `codebase-map.md` (entities `OutboxEvent`, `Creator` fields, endpoints, admin components, inventory, "dialogs not wired"), `tech-stack.md` decisions (outbox scope split, lock order, creator columns, display-name copy, pre-check behaviour, seed change), QA reports.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/src/auth/api-client.ts` (+ spec) | three calls |
| MODIFY | `packages/ui/src/components/dialog/ConfirmDialog.tsx`, `ConfirmDialog.spec.tsx` | `confirmDisabled` |
| CREATE | `apps/admin/src/creators/ApproveRequestDialog.tsx`, `RejectRequestDialog.tsx`, `copy.ts`, `*.spec.tsx`, `review-dialog.module.css` | dialogs |
| MODIFY | `apps/admin/src/preview/Preview.tsx`, `fixtures.ts`, `Preview.spec.tsx` | preview sections |
| MODIFY | `visual/specs/visual.spec.ts` | five admin items |
| MODIFY | `.agile/features/admin-accounts/US-014-…md`, `US-015-…md` | wiring acceptance bullets |

**Testing:** component tests with a fake API: pre-check OK shows the "Diperiksa ulang" line and an enabled confirm; pre-check with a block opens the fail state with the confirm disabled; confirm shows "Memproses…", closes nothing while busy and calls the API once on a double click; a 409 blocked turns into the fail state; a 409 already reviewed closes and reports the status; reject empty → inline error and no call; reject sends the trimmed reason; a failed call keeps the typed reason and shows the inline message; the load failure shows retry; the reason is rendered as text. `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm visual` pass.

---

## Implementation order

TASK-071 → TASK-072 → TASK-073 → TASK-074 → TASK-075 (rebuild `contracts` and `db` before the services and the admin app see them).

## Open inputs

- Rejected-request **bot message copy** is still undesigned (US-013 placeholder).
- Placeholder wording (no board): the reason's "too long" / "invalid" messages and the dialog's load-failure text.
- Not wired until US-014/015: the row/header buttons, `AdmCreatorsToastRej`, `AdmCrApproved`. The story's UAT is API-level plus the `/__preview` dialogs.
- No bot message until US-013 (events wait in `outbox_events`).
