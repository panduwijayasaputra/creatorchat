# Technical Plan: US-010 — Submit a creator request

## Architecture Overview

Agreed with the user (2026-11-16, all recommended options):

1. **One read endpoint** `GET /v1/me/creator-request` (USER only) returns `{ request, blocked }`: the user's latest request (or null) and, when they hold an active or future customer subscription, the subscription that blocks them. The form and `Profile` read it; US-011 reuses it for the status screen. The server re-checks the block on submit, so the read is advisory only.
2. **Submit** `POST /v1/me/creator-request`. One PENDING request per user, enforced by a partial unique index. A second submit (double tap, retry, two tabs) returns the existing pending request, not an error.
3. **After a successful submit** the Mini App goes to `/profile/creator-request/status`, a "belum dibangun" placeholder that US-011 replaces. The form itself redirects there when a pending request already exists.
4. **Minimal `Subscription` table** is added now (feature.md decision) with no grant/extend/revoke API. The seed gives Raka Putra an active subscription to Salsa until 27 Nov 2026, so the blocked path can be tried locally. Phase C builds on this table.
5. The `CreatorApplication` table is created complete (including review columns) so US-011/US-012 need no second migration for it. US-010 only ever writes PENDING rows.

Brief refs: §3, §5, §13, §15, §17. Design refs: `CreatorRequest`, `RequestStates` (1 validasi, 2 mengirim, 3 gagal), `CreatorRequestBlocked`, `ProfileBlocked`, `Profile`. `CreatorRequestRetry`, `RequestPending`, `RequestRejected`, `ProfilePending`, `ProfileRejected` belong to US-011.

Slice: contracts → migration + seed → `CreatorRequestService` (backend-core) → API routes → Mini App form → Profile blocked variant + visual.

## Authorization & Data Rules

- **Who:** `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('USER')` on both routes. A CREATOR gets 403 `FORBIDDEN_ROLE`; no token / admin token gets 401. The user id comes only from the session. Bodies use plain `z.object`, so `user_id`, `role`, `status`, `id`, etc. are stripped.
- **Blocked or stale account:** the submit transaction first locks the caller's row: `SELECT … FROM users WHERE id = $1 AND status = 'ACTIVE' AND role = 'USER' FOR UPDATE`. No row → `CreatorRequestAccountNotActiveError` → 401 `UNAUTHENTICATED` (same mapping as the profile edit). The lock also serialises two concurrent submits of the same user.
- **Order inside the transaction:** (1) lock user; (2) if a PENDING request exists, return it (no write, no audit); (3) if a blocking subscription exists, throw `CreatorRequestBlockedError` → 409 `CREATOR_REQUEST_BLOCKED` (nothing written, no subscription touched); (4) insert PENDING; (5) audit row `creator.application.submitted` (actor USER, target `creator_application` + id, no free text in `changes`, only `{type}`). On a unique violation from the partial index (should be unreachable under the lock), re-read and return the pending row.
- **Blocking subscription** = `customer_id = user AND revoked_at IS NULL AND ends_at > now()` (covers active and future, brief §5). The one reported to the client is the one with the latest `ends_at` ("setelah seluruh langganan berakhir"); the response carries the creator's display name and `ends_at`. Nothing is revoked or changed.
- **Validation (contract, shared by server and Mini App):**
  - `creator_name`: trimmed, 1–40 code points, no control characters (same rule as the profile display name).
  - `instagram_url`: trimmed; parsed with `URL`; protocol http/https; host `instagram.com` or `www.instagram.com` (nothing else, no userinfo/port); path exactly one handle segment `^/[A-Za-z0-9._]{1,30}/?$`; the stored value is normalised to `https://instagram.com/<handle>` (query and fragment dropped). Error copy: "Link Instagram tidak valid. Contoh: https://instagram.com/namaakun".
  - `creator_type`: `HUMAN` | `AI_CHARACTER`.
  - `description`: trimmed, required ("Deskripsi wajib diisi."), ≤300 code points, no control characters except newline.
  - `rights_confirmed`: must be `true` ("Centang pernyataan ini untuk melanjutkan."). It is not stored as a column; the API refuses without it, and the audit row records the submission time.
  - Errors reach the client as 400 `VALIDATION_FAILED` with the field list from the existing validation pipe.
- **Read endpoint:** returns only the caller's own data. It takes no id. `no-store` via the `/v1/me` prefix (already covered).
- **No outbox, no job, no socket event** in this story (the bot result is US-013).
- **Role never changes** here. A pending request does not elevate anything (brief §17).

## Dependencies

- No new packages.
- Prior stories: US-004/006 (user guard, roles), US-007 (display name rules, `ProfileForm` patterns), US-009 (`formatDateTime`, used for "hingga 27 Nov 2026").
- Env vars: none new.

## Risks

- **Double submit / two tabs:** partial unique index plus row lock. Tested with `Promise.all`.
- **Subscription granted between page load and submit:** the server re-checks under the lock, so the form's 409 handler reloads the state and shows the blocked variant (values the user typed are kept in the form state but disabled).
- **Rejected users (US-011):** until US-011, a user whose latest request is REJECTED sees the normal empty form (no prefill, no reason). Not reachable in the UI before US-012 can reject, but the API already allows a new PENDING row after a REJECTED one.
- **Design copy for the loading and load-failed state of the form** has no board. Placeholder copy goes in one constants file and is reported as an open input.
- **Seed:** the seed subscription must only be written by the local seed, and idempotently. Fixture creator is "Salsa", so the blocked card reads "Salsa", not "Salsa Maheswari" as in the board (data, not layout).
- **Instagram check is syntactic only.** It does not verify the account exists (admin reviews it).

## Tasks

### TASK-062: Contracts, migration (`creator_applications`, `subscriptions`) and seed

Contracts (`packages/contracts/src/creator-request.ts`, exported from `index.ts`, with spec):

- `CREATOR_REQUEST_PATH = '/v1/me/creator-request'`.
- `CreatorTypeSchema = z.enum(['HUMAN','AI_CHARACTER'])`, `CreatorApplicationStatusSchema = z.enum(['PENDING','APPROVED','REJECTED'])`.
- `normalizeInstagramUrl(input: string): string | null` (rules above).
- `SubmitCreatorRequestSchema = z.object({ creator_name, instagram_url, creator_type, description, rights_confirmed: z.literal(true) })` with the Indonesian messages above; exported `SubmitCreatorRequestInput` type. The parsed output has the normalised URL.
- `CreatorApplicationSchema = z.strictObject({ id, status, creator_name, instagram_url, creator_type, description, created_at, reviewed_at: nullable, review_reason: nullable })`.
- `CreatorRequestBlockSchema = z.strictObject({ creator_name: z.string(), ends_at: z.string() })`.
- `CreatorRequestStateResponseSchema = z.strictObject({ request: CreatorApplicationSchema.nullable(), blocked: CreatorRequestBlockSchema.nullable() })`; `SubmitCreatorRequestResponseSchema = z.strictObject({ request: CreatorApplicationSchema })`.
- `ErrorCode.CREATOR_REQUEST_BLOCKED` added to the shared error codes.

Prisma (`packages/db/prisma/schema.prisma` + a new migration):

- Enums `CreatorType { HUMAN AI_CHARACTER }`, `CreatorApplicationStatus { PENDING APPROVED REJECTED }`.
- `CreatorApplication` → `creator_applications`: `id` uuid, `user_id` FK users (RESTRICT), `creator_name`, `instagram_url`, `creator_type`, `description`, `status` default PENDING, `reviewed_by_admin_id` nullable FK admin_accounts (RESTRICT), `reviewed_at` nullable, `review_reason` nullable, `created_at`, `updated_at`. Index `(user_id, created_at)`. **Partial unique index** `creator_applications_one_pending_idx ON (user_id) WHERE status = 'PENDING'` (raw SQL in the migration). CHECK: status PENDING ⇒ reviewed fields NULL; REJECTED ⇒ `review_reason` NOT NULL (belt and braces for US-012).
- `Subscription` → `subscriptions`: `id`, `customer_id` FK users (RESTRICT), `creator_id` FK creators (RESTRICT), `starts_at`, `ends_at`, `revoked_at` nullable, `created_at`, `updated_at`; `UNIQUE (customer_id, creator_id)`; CHECK `ends_at > starts_at`; index `(customer_id)`.
- Relations added on `User` / `Creator` / `AdminAccount`.

Seed (`packages/db/seed/`): fixture `SUBSCRIPTION_FIXTURES` with Raka Putra → `salsa234`'s creator, `starts_at` 2026-11-01, `ends_at` 2026-11-27 (UTC midnight), idempotent upsert on the unique pair; runs after users/creators exist. The seed stays local-only (existing guard).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-request.ts` (+ `.spec.ts`) | schemas, URL normaliser, path |
| MODIFY | `packages/contracts/src/index.ts`, `src/errors.ts` (wherever `ErrorCode` lives) | exports, `CREATOR_REQUEST_BLOCKED` |
| MODIFY | `packages/db/prisma/schema.prisma` | two models, two enums, relations |
| CREATE | `packages/db/prisma/migrations/20261119010000_creator_applications_subscriptions/migration.sql` | tables, partial unique index, CHECKs |
| MODIFY | `packages/db/seed/fixtures.ts`, `seed/seed.ts`, `seed/seed.int.spec.ts` | Raka's subscription |

**Testing:**
- Contract spec: every Instagram accept/reject case (`instagram.com/x`, `https://www.instagram.com/x/`, `http://`, uppercase host, trailing slash, query/fragment stripped, `instagram.com.evil.com`, `evil.com/instagram.com/x`, `user@instagram.com`, extra path segment, empty, 31-char handle, spaces); name/description limits by code point (emoji); `rights_confirmed` false/missing/"true"; unknown keys stripped.
- DB integration: partial unique index rejects a second PENDING for one user but allows PENDING after REJECTED and APPROVED; CHECKs reject bad review combinations; subscription pair uniqueness and `ends_at > starts_at`; seed twice gives one subscription row.

---

### TASK-063: `CreatorRequestService` (backend-core)

`packages/backend-core/src/creator-request/creator-request.service.ts` (+ `index.ts`, exported from `src/index.ts`):

- `class CreatorRequestAccountNotActiveError`, `class CreatorRequestBlockedError { block: CreatorRequestBlock }`.
- `constructor(prisma: Pick<PrismaClient,'$transaction' | 'creatorApplication' | 'subscription'>, clock: () => Date = () => new Date())`.
- `getState(userId): Promise<{ request: CreatorApplication | null; blocked: CreatorRequestBlock | null }>` — latest request by `created_at desc` and the blocking subscription (latest `ends_at`, creator display name via `creator.user.displayName`). Read-only, scoped by `userId`.
- `submit(userId, input: SubmitCreatorRequestInput): Promise<CreatorApplication>` — the transaction order above. Uses the injected clock for the subscription check so tests are deterministic.
- Mapping helper `toCreatorApplication(row)` (ISO strings).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-request/creator-request.service.ts` (+ `index.ts`) | domain logic |
| CREATE | `packages/backend-core/src/creator-request/creator-request.service.int.spec.ts` | integration tests on the test DB |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing (integration, real test DB):**
- Happy path: row is PENDING, role/status/session_version unchanged, audit row written, returned values are the normalised ones.
- Duplicate: second call returns the same row id, one row total, one audit row. `Promise.all` of 5 submits → one row, all return the same id.
- Blocked: active subscription → `CreatorRequestBlockedError` with creator name and `ends_at`; a future-start subscription also blocks; expired and revoked do not block; the latest `ends_at` is reported when there are several; no `subscriptions` row changes; no application row, no audit.
- After REJECTED: a new PENDING is created and the REJECTED row is unchanged.
- Pending exists + a subscription appears: returns the existing pending (no error).
- BLOCKED user, CREATOR role, unknown id → `CreatorRequestAccountNotActiveError`, nothing written.
- `getState` returns only the caller's data (another user's request never appears); null/null for a fresh user.

---

### TASK-064: `GET` and `POST /v1/me/creator-request`

`apps/api/src/modules/me/` (extend `MeModule` or add a small `CreatorRequestController` under `/v1/me` registered in `MeModule`; provide `CreatorRequestService` through a token in `tokens.ts`):

- `GET /v1/me/creator-request` → `CreatorRequestStateResponse`, 200.
- `POST /v1/me/creator-request`, `@HttpCode(200)`, body validated with `SubmitCreatorRequestSchema` through `ZodValidationPipe` → `{ request }`.
- Both: `@Roles('USER')` (controller already has `UserJwtGuard, RolesGuard`).
- Error mapping: `CreatorRequestAccountNotActiveError` → 401 `UNAUTHENTICATED`; `CreatorRequestBlockedError` → 409 `CREATOR_REQUEST_BLOCKED` with the block in `details` (name + `ends_at`, no ids).
- `no-store` already applies to `/v1/me`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/me/creator-request.controller.ts` | the two routes |
| MODIFY | `apps/api/src/modules/me/me.module.ts`, `tokens.ts` | wiring |
| CREATE | `apps/api/test/creator-request.int.spec.ts` | API integration tests |

**Testing (sign in through `buildSignedInitData`):**
- Submit: 200 with PENDING; the stored role stays USER; `user_id`/`role`/`status`/`id` in the body are ignored; each invalid field gives 400 `VALIDATION_FAILED` with nothing written (bad host, `instagram.com.evil.com`, empty name, 41-char name, description empty / 301 chars, type `BOTH`, `rights_confirmed` false/missing).
- Idempotency: the same submit twice, and 5 concurrent submits, give one row and the same `request.id`.
- Blocked: seeded active subscription → 409 `CREATOR_REQUEST_BLOCKED` with the creator name and date; `GET` shows `blocked`; the subscription row is unchanged; an expired one does not block.
- IDOR: user A never sees user B's request in `GET`; submitting as B does not touch A's.
- Auth: CREATOR → 403 `FORBIDDEN_ROLE` on both; no / garbage / admin token → 401; a blocked account and a stale `session_version` → 401 and nothing written.
- After the (test-created) REJECTED row, a new submit creates a second row and `GET` returns the newest.
- `Cache-Control: no-store` on both.

---

### TASK-065: `/profile/creator-request` form (`CreatorRequest`, `RequestStates`, `CreatorRequestBlocked`)

Screens (view each PNG, copy exact values from the HTML; no bottom nav, own header with back arrow to `/profile`, scrolling body, sticky bottom bar):

- **Form** (`CreatorRequest`): Nama creator (prefilled from `user.display_name`, hint "Terisi dari nama tampilmu. Bisa diubah."), Link profil Instagram (placeholder `https://instagram.com/namaakun`, hint "Dipakai admin untuk memeriksa akunmu."), Jenis creator `radiogroup` (Creator Asli default / Karakter AI; roving tabindex + arrow keys, like `CreatorTimezonePage`), Deskripsi singkat konten (textarea, counter `n/300` by code point), rights checkbox, info note, **Kirim Permintaan** with the send icon. Buttons never wrap.
- **States** (`RequestStates`): (1) client validation uses the same contract schema and shows the inline errors on submit, focusing the first invalid field; the Instagram, description and checkbox error texts are verbatim from the board; (2) while sending: every field and the button disabled, label "Mengirim…", `aria-busy`, a double tap sends one request; (3) failure (network / 5xx / unknown): banner "Permintaan belum terkirim" + "Koneksi terputus. Isianmu masih ada di sini. Coba kirim lagi." and every typed value kept. Server 400 field messages are mapped to the same inline errors.
- **Blocked** (`CreatorRequestBlocked`): "Belum bisa mengajukan" card with "Permintaan menjadi creator dapat diajukan setelah seluruh langganan pelanggan berakhir."; fields and button disabled. Shown when `GET` returns `blocked`, and when `POST` answers 409 (reload the state; typed values stay).
- **Load**: the page calls `getCreatorRequestState()`. Loading and load-failed (with "Coba Lagi") states use placeholder copy in `apps/miniapp/src/profile/creator-request-copy.ts` (open input, reported). When `request.status === 'PENDING'` the page `<Navigate replace>`s to `/profile/creator-request/status`. A REJECTED latest request shows the normal empty form for now (US-011 adds the prefill and reason).
- **Success**: navigate to `/profile/creator-request/status`.
- **Routes** (`routes.tsx`): real `/profile/creator-request` (USER only, outside the shell); new `/profile/creator-request/status` is a `NotImplemented` placeholder owned by US-011.
- **API client**: `getCreatorRequestState()` and `submitCreatorRequest(input)` in `api-client.ts` (single-flight 401 re-exchange and body replay already exist); `MiniappApi` type, fake API (`creatorRequestState`, `submitResults` queues and call arrays).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/profile/CreatorRequestPage.tsx` | form + states + blocked |
| CREATE | `apps/miniapp/src/profile/creator-request.module.css` | styles from the HTML values |
| CREATE | `apps/miniapp/src/profile/creator-request-copy.ts` | placeholder load copy |
| CREATE | `apps/miniapp/src/profile/CreatorRequestPage.spec.tsx` | behaviour tests |
| MODIFY | `apps/miniapp/src/app/routes.tsx` (+ `router.spec.tsx`) | real route + status placeholder |
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec), `AuthProvider.tsx` if needed, `test/fake-miniapp-api.ts` | client + fake |
| MODIFY | `packages/ui/src/...` | only if a textarea / checkbox / send icon is missing (check first; reuse the input components) |

**Testing:**
- Prefill from the display name; counter by code point; each field error text verbatim; the first invalid field is focused; nothing is sent while invalid.
- Radiogroup keyboard behaviour; the chosen type is sent.
- Submit sends the normalised contract body and navigates to the status route; a double click sends one request; fields and button disabled with "Mengirim…" while pending.
- Failure keeps every value and shows the banner; retry works; a server 400 maps to inline errors.
- 409 blocked response switches to the blocked variant with fields disabled; initial `blocked` renders it; pending request redirects; load failure shows retry; a CREATOR is redirected by `RequireRole` and the API is never called.

---

### TASK-066: `Profile` blocked variant (`ProfileBlocked`) and visual checks

- `ProfilePage` reads `getCreatorRequestState()` and, when `blocked` is set, replaces the invitation card with the `ProfileBlocked` variant: "Ingin menjadi creator?", "Permintaan menjadi creator dapat diajukan setelah seluruh langganan pelanggan berakhir.", the line "Langganan aktif: <creator_name>, hingga <date>" (date with `formatDateTime(ends_at, user.timezone, …)` → "27 Nov 2026", day-month-year as the board), and the **Ajukan Jadi Creator** button as the board shows it (check the PNG for the disabled/secondary look). While the state loads or fails, the invitation card stays in its normal form (the server still refuses a blocked submit). Pending / rejected variants are US-011.
- Playwright visual items in `visual/specs/visual.spec.ts`: `miniapp-creator-request` (390×1180), `miniapp-creator-request-states` for the three `RequestStates` panels if the harness supports per-panel clips (follow how `editStates` is done), `miniapp-creator-request-blocked`, `miniapp-profile-blocked`. Route mocks supply `GET /v1/me/creator-request`. Review side by side with the PNGs; text may differ ~1 px as in earlier screens.
- Update `codebase-map.md`, `tech-stack.md` decisions log (one-pending index, minimal `Subscription`, Instagram normalisation, blocking rule) at story completion (dev-team).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/profile/ProfilePage.tsx`, `profile.module.css`, `ProfilePage.spec.tsx` | blocked variant |
| MODIFY | `visual/specs/visual.spec.ts` | new items |

**Testing:**
- Blocked state shows the explanation, the subscription line with the date in the user's timezone, and the button disabled or hidden per the board; the unblocked state is unchanged from US-007 (existing tests keep passing); a failed state call leaves the normal card.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm visual` all pass.

---

## Implementation order

TASK-062 → TASK-063 → TASK-064 → TASK-065 → TASK-066 (rebuild `contracts` and `backend-core` before api/miniapp see the changes).

## Open inputs

- Placeholder copy (no board): the form's loading and load-failed text and "Coba Lagi" (`creator-request-copy.ts`).
- The "Syarat/rights" wording is verbatim from the board; nothing else invented.
- No Retry prefill, rejected reason or status screen yet (US-011); the success redirect lands on a placeholder until then.
