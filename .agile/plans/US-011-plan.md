# Technical Plan: US-011 — Creator request status and resubmission

## Architecture Overview

Agreed with the user (2026-11-16, both recommended options):

1. **No new endpoint and no migration.** US-010's `GET /v1/me/creator-request` already returns the caller's latest request (status, submitted values, `review_reason`, `reviewed_at`) and the subscription block. Everything in this story is read-side UI plus tests and seed data. The status comes from the server on every screen; nothing is kept in local state.
2. **Retry lives on the same route.** `/profile/creator-request` shows the `CreatorRequestRetry` variant whenever the latest request is REJECTED: the form is prefilled from that request and a reason card sits on top. Submitting creates a **new** PENDING row; the rejected row is never edited (history kept for admins, US-018). The Profile "Perbaiki dan Ajukan Lagi" button and the status screen's button both link to this route.
3. **Status screen** `/profile/creator-request/status` (replaces the US-010 placeholder) renders `RequestPending` or `RequestRejected` from the latest request. No request (or an APPROVED one) redirects to `/profile`.
4. **Seed:** Maya Lestari gets a PENDING request and Luna Aurora a REJECTED one (board's reason), so the screens can be tried before US-012 exists. Raka Putra stays request-free so the US-010 blocked path keeps working; US-012 adds his pending request for the failing-approval case.

Brief refs: §5 (statuses; rejection keeps the reason; resubmit without deleting history), §17 (a pending request does not elevate the role). Design refs: `RequestPending`, `ProfilePending`, `RequestRejected`, `ProfileRejected`, `CreatorRequestRetry`; `RequestStates` and `CreatorRequestBlocked` still apply to the retry form.

Slice: contracts helper → seed + API tests → status screen → retry variant → Profile variants + visual.

Not built (by design):
- The `RequestPending` DEMO strip ("DEMO · bukan fitur produk") is a design demo, not a feature.
- `RequestApproved` is the bot's Telegram message (US-013). After approval the account is CREATOR with a stale session, the next call re-exchanges and the app lands on `/inbox`; there is no in-app approved screen to build (nothing is invented).

## Authorization & Data Rules

- **Who:** unchanged from US-010: `@Roles('USER')`, caller id from the session, no user or request id anywhere in the request, so reading another user's request is impossible by construction (the story's "another user's id → 404" has no id to attack; tests prove no leakage). A CREATOR gets 403; a blocked or stale session gets 401.
- **Which request counts:** the latest by `created_at` (any status). Older rows are history and are never returned to the user.
- **Resubmit:** the existing US-010 transaction (row lock, existing-PENDING return, block check, insert). A rejected row has no PENDING status, so a new row is allowed; the partial unique index still stops two PENDING rows.
- **Approved meanwhile:** approval changes the role and bumps `session_version` (US-012), so the next request is a stale session (401) → Mini App re-authenticates → lands on `/inbox`. Already covered by US-006; US-011 adds one test through the request endpoint.
- **Precedence on screens:** a PENDING request wins over everything (the user already applied). A block wins over REJECTED (they cannot apply now, so the Profile shows the explanation, not a retry button). Otherwise REJECTED shows the retry path, otherwise the normal invitation.
- **Rejection reason** is admin text. Render it as plain text only (React escaping; never HTML).
- No outbox, no job, no audit write (reads only).

## Dependencies

- No new packages. Prior stories: US-010 (endpoint, form, `creator-request-copy.ts`), US-007 (Profile page), US-009 (`formatDateTime` if a date is shown).
- Env vars: none.

## Risks

- **Stale view:** a user keeping the status screen open will not see the decision until they reload or return. The Telegram message (US-013) tells them; the screen refetches on mount. Mitigation if wanted later: refetch on visibility change.
- **Seed vs US-010 UAT:** seeding Raka a pending request would hide the blocked screens, so he is deliberately left out.
- **Retry prefill of an invalid stored link:** stored links are normalised by US-010, so they always pass the schema; if one ever did not, the normal inline error shows.
- **Design gap:** loading / load-failed copy for the status screen has no board; it reuses the US-010 placeholder constants (reported as open input).

## Tasks

### TASK-067: Seed (pending and rejected fixtures), `instagramHandle` helper, status-read API tests

Contracts: `instagramHandle(url: string): string` in `packages/contracts/src/creator-request.ts` — returns `@maya.lestari` for a stored `https://instagram.com/maya.lestari`, and the input unchanged when it does not match (never throws). Spec cases: normal, trailing slash, uppercase handle kept, unknown shape returned as is.

Seed (`packages/db/seed/fixtures.ts`, `run-seed.ts`): add `APPLICATION_FIXTURES`:
- Maya Lestari (`9_000_000_011n`): PENDING, "Maya Lestari", `https://instagram.com/maya.lestari`, `HUMAN`, "Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.".
- Luna Aurora (`9_000_000_013n`): REJECTED, "Luna Aurora", `https://instagram.com/luna.aurora`, `AI_CHARACTER`, a short description, `reviewReason` "Link Instagram belum bisa kami verifikasi. Pastikan akun publik dan sesuai nama creator.", `reviewedAt` 2026-11-15, no reviewing admin (the seed admin is optional; leave `reviewed_by_admin_id` NULL, allowed by the CHECK).
- Idempotent: create only when the user has no application with that status; never touch an existing row. `SeedResult` gains `applicationsCreated`; `seed.ts` prints it. Raka Putra gets none.

API integration tests (`apps/api/test/creator-request.int.spec.ts`, extend): `GET` for a REJECTED latest request returns the reason and `reviewed_at`; a PENDING latest request is returned with the submitted (normalised) values; with history (old REJECTED + newer PENDING) only the newest is returned and the older row's data never appears; submitting after the account was approved (`changeRole` to CREATOR) answers 401 and writes nothing; the response never contains `user_id`, `reviewed_by_admin_id` or internal ids besides the request id.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/creator-request.ts` (+ spec) | `instagramHandle` |
| MODIFY | `packages/db/seed/fixtures.ts`, `run-seed.ts`, `seed.ts`, `seed.int.spec.ts` | fixtures + idempotency test |
| MODIFY | `apps/api/test/creator-request.int.spec.ts` | read-side tests |

**Testing:** as above, plus the seed runs twice with one pending row for Maya and one rejected row for Luna, and a user with no fixture (Raka) has none.

---

### TASK-068: Status screen `/profile/creator-request/status` (`RequestPending`, `RequestRejected`)

`apps/miniapp/src/profile/CreatorRequestStatusPage.tsx` (+ CSS module and spec), taking `api: Pick<MiniappApi, 'getCreatorRequestState'>`; USER only, outside the shell (no bottom nav), header "Status permintaan" with the back arrow to `/profile`. Replace the `NotImplemented` placeholder in `routes.tsx`.

- **Pending** (`RequestPending`): chip "Sedang Ditinjau" (existing status chip; add a `pending` kind only if it is missing), "Hasil peninjauan akan dikirim melalui Telegram.", the key/value card (Nama creator, Instagram as `instagramHandle(...)`, Jenis as "Creator Asli" / "Karakter AI", Deskripsi), "Akunmu tetap USER dan dapat memakai fitur pelanggan. Permintaan kedua tidak bisa dibuat selama masih ditinjau.", **Kembali ke Profil**. No DEMO strip.
- **Rejected** (`RequestRejected`): chip "Ditolak", "Permintaan menjadi creator belum bisa disetujui.", "Alasan dari admin" card with the stored reason (plain text), "Akunmu tetap USER. Kamu bisa memperbaiki isian lalu mengajukan lagi.", **Perbaiki dan Ajukan Lagi** (link to `/profile/creator-request`), **Kembali ke Profil**.
- No request, or an APPROVED latest request (stale view) → `<Navigate to="/profile" replace />`.
- Loading and load-failed (with "Coba Lagi") use `REQUEST_GAP_COPY` from `creator-request-copy.ts` (placeholder, reported). Buttons never wrap.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/profile/CreatorRequestStatusPage.tsx`, `creator-request-status.module.css`, `CreatorRequestStatusPage.spec.tsx` | the screen |
| MODIFY | `apps/miniapp/src/app/routes.tsx` (+ `router.spec.tsx` if it names the placeholder) | real route |
| MODIFY | `apps/miniapp/src/profile/creator-request-copy.ts` | rename the shared state copy if needed (keep exports stable) |

**Testing:** pending shows the chip, copy and submitted values (handle form, type label); rejected shows the reason verbatim and both buttons; an HTML-looking reason renders as text; "Perbaiki dan Ajukan Lagi" navigates to the form; no request and APPROVED redirect to `/profile`; load failure shows retry then the screen; a CREATOR is redirected and the API is never called; the screen never sends a request id (the fake API sees only the state call).

---

### TASK-069: Retry variant of the form (`CreatorRequestRetry`)

Extend `CreatorRequestPage.tsx` (US-010) — no new route:

- When the latest request is REJECTED, render the Retry variant: a reason card on top ("Alasan penolakan sebelumnya: <reason>", the `.note` style from `CreatorRequestRetry`), and the form **prefilled** from that request (name, Instagram link, type, description). The rights checkbox starts **unchecked** (the user confirms again); the board's `81/300` counter follows the prefilled text.
- Everything else is unchanged: validation, sending, failure with values kept, 409 → blocked variant (prefilled values shown disabled).
- Submitting sends the same body; success goes to `/profile/creator-request/status`, which now shows the new PENDING request. The rejected one stays in history.
- A PENDING latest request still redirects to the status screen (US-010).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/profile/CreatorRequestPage.tsx`, `creator-request.module.css`, `CreatorRequestPage.spec.tsx` | retry variant |

**Testing:** prefill from the rejected request, reason card text verbatim (plain text), checkbox starts unchecked and submit is refused until checked, counter shows the prefilled length, edited values are what is sent, a rejected user who is also blocked sees the blocked variant with prefilled disabled fields, a normal user (no request) sees the empty form with no reason card, success navigates to the status route.

---

### TASK-070: Profile variants (`ProfilePending`, `ProfileRejected`) and visual checks

`ProfilePage.tsx` already reads the state (US-010). Extend the creator card by precedence **pending > blocked > rejected > invitation**:

- **ProfilePending:** title "Permintaan creator" with the "Sedang Ditinjau" chip, "Hasil peninjauan akan dikirim melalui Telegram. Kamu tetap bisa memakai fitur pelanggan.", **Lihat Status** (outline button → `/profile/creator-request/status`).
- **ProfileRejected:** title "Permintaan creator" with the "Ditolak" chip, the stored reason, **Perbaiki dan Ajukan Lagi** (→ `/profile/creator-request`).
- Blocked and the normal invitation stay as in US-010. A failed state load keeps the normal invitation.
- Playwright items (`visual/specs/visual.spec.ts`), each reviewed side by side with the PNG: `miniapp-request-pending` (`RequestPending`, 390×844), `miniapp-request-rejected` (`RequestRejected`, 390×844), `miniapp-creator-request-retry` (`CreatorRequestRetry`, 390×1180), `miniapp-profile-pending` and `miniapp-profile-rejected` (390×1300). Route mocks supply `GET /v1/me/creator-request`. The DEMO strip in `RequestPending` is outside the app region and is not compared.
- At story completion (dev-team): `codebase-map.md` (routes, seed fixtures, inventory), `tech-stack.md` decisions (retry on the same route; precedence rule; seed), QA reports.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/profile/ProfilePage.tsx`, `profile.module.css`, `ProfilePage.spec.tsx` | pending and rejected variants |
| MODIFY | `visual/specs/visual.spec.ts` | five items |

**Testing:** each variant renders its copy and button and links to the right route; precedence (pending beats blocked, blocked beats rejected, rejected beats the invitation); a failed load keeps the invitation; existing Profile tests keep passing. `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm visual` pass.

---

## Implementation order

TASK-067 → TASK-068 → TASK-069 → TASK-070 (rebuild `contracts` before the miniapp sees `instagramHandle`).

## Open inputs

- Placeholder copy (no board): the status screen's loading / load-failed text (shared with the form).
- Design-only items not built: the `RequestPending` DEMO strip; `RequestApproved` is the bot message (US-013), and an approved account goes straight to `/inbox`.
- No auto-refresh of the status screen; it loads on open.
