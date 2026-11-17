# Technical Plan: US-022 — Explore and creator profile by access state

> Task ids 127–132 (120–126 belong to US-021). Builds on US-005 (`/creators/:publicCode`, `GET /v1/creators/by-code/:code`), US-020 (`subscriptions`, `subscription_events`, `conversations`, `isEntitled`), US-021 (`entitledSubscriptionSql`, the one read-side entitlement rule), US-007 / US-009 (profile, the account's display time zone). The actions behind the profile buttons belong to later stories (US-023 request access, US-026 / US-027 chat); here they are drawn and answer with a placeholder message.

## Architecture Overview

Agreed with the user (2026-11-17, recommended options):

1. **`access_requests` is created here, US-023 writes it.** US-022 adds the migration (schema, indexes, a partial unique index so one customer has at most one PENDING request per creator) and reads it; seed and tests insert rows. The **pending** state is real and testable now.
2. **One state per profile, precedence `ACTIVE > PENDING > EXPIRED > GUEST`.** A pending request (trial or renewal) shows `CreatorPending` even after the access ended; `CreatorExpired` shows only when nothing is pending. A revoked subscription counts as expired.

```
GET /v1/creators?page&page_size           @Roles('USER')  → CreatorAccessService.explore(userId, q)   (Explore)
GET /v1/creators/by-code/:publicCode      @Roles('USER')  → CreatorAccessService.profile(userId, code) (CreatorGuest|Pending|Active|Expired)
                                                            both use accessStateOf(subscription, pendingRequest, now)

/explore                      ExplorePage      (Explore)
/creators/:publicCode         CreatorProfilePage (CreatorGuest / CreatorPending / CreatorActive / CreatorExpired; StatesProfile when unavailable)
```

- **One pure state function.** `accessStateOf({ subscription, pending }, now)` in backend-core returns `{ state: 'ACTIVE', endsAt } | { state: 'PENDING', requestedAt, type } | { state: 'EXPIRED', endedAt, revoked } | { state: 'GUEST' }`. `ACTIVE` uses the same rule as `isEntitled` / `entitledSubscriptionSql` (not revoked and `starts_at <= now < ends_at`; the customer is an ACTIVE USER by the guard, the creator ACTIVE because the endpoint only answers for ACTIVE creators). Explore and profile both call it, so the two screens cannot disagree. The Explore list loads the page's creators first, then the viewer's subscriptions and pending requests for exactly those creators, and applies the function (at most 50 rows, no per-row queries). `now` is read once per request, so an `ends_at` that passed a minute ago is expired.
- **Profile answers extend the deep-link answer.** `GET /by-code/:code` keeps its US-005 fields (`public_code`, `display_name`, `bio`, `avatar_url`: no ids, no status) and adds `access`, a discriminated union on `state` with only the fields that state needs (`ends_at` for ACTIVE, `ended_at` + `revoked` for EXPIRED, `requested_at` + `request_type` for PENDING). **No media data of any kind** for any state (Resolved Conflict #1): no tiles, counts, durations or URLs; the ACTIVE gallery is a placeholder until Phase D.
- **Explore** lists ACTIVE creators (creator row ACTIVE and account ACTIVE; applications and blocked creators never appear) ordered by display name then id, server-paginated (`page`, `page_size` 10 / 20 / 50, default 20). Each item: `public_code`, `display_name`, `bio`, `avatar_url`, `access` as `ACTIVE | PENDING | EXPIRED | null` (null = no relation, no chip).
- **Dates** are shown in the viewer's account time zone (`users.timezone`, already on the profile) through the Mini App's existing `formatDateTime` / `formatTime`, never hard-coded WIB. The board copy "Berakhir pukul 23.59 WIB" is the Jakarta rendering of the stored `ends_at` (23:59:59 Jakarta, set by US-020); for another zone the clock shows that zone's time with its label.
- **Unavailable** (unknown, malformed, blocked creator): unchanged US-005 behaviour, one identical 404, shown as `StatesProfile` "Creator tidak tersedia" with the way to Jelajahi. A CREATOR token gets 403 `FORBIDDEN_ROLE` from both endpoints (`RolesGuard`) and the existing CREATOR explanation page.
- **Buttons whose behaviour is another story** (**Minta Akses Uji Coba**, **Minta Perpanjangan Akses** → US-023; **Buka Chat**, **Lihat Riwayat Chat** → US-026 / US-027; the "Menunggu Persetujuan" button of `CreatorPending` is a status, not an action): rendered exactly as drawn; a tap shows a placeholder `BottomToast` ("Fitur ini belum tersedia."), not a disabled button (touch screens show no tooltips). Flagged as gaps.

Brief refs: §4 (deep link chooses a target only), §6 (capability table), §8A (no gallery media for non-subscribers), §10, §13 (`AccessRequest`). Design refs: `Explore` (390×844), `CreatorGuest` (390×1590), `CreatorPending` (390×1650), `CreatorActive` (390×1400), `CreatorExpired` (390×1670), `StatesProfile`. The boards' category / city line ("Fotografi & perjalanan · Yogyakarta") has no data model: omitted, as in US-008 (known gap). The gallery tile grid of the boards (durations "0:52 …") is **not** built: non-active states show only the "Galeri tersedia untuk subscriber aktif" panel, the active state a placeholder.

Out of scope: submitting an access request and the admin review (US-023 / US-024), the customer Langganan page (US-025), the chat (US-026+), the gallery (Phase D), push notifications.

## Authorization & Data Rules

- **Principal:** signed-in customers only: `@UseGuards(UserJwtGuard, RolesGuard)` and `@Roles('USER')` on both routes (the `roles-declared` test keeps failing closed). CREATOR → 403 `FORBIDDEN_ROLE`; admin tokens and no token → 401. `Cache-Control: no-store`.
- **Scoping:** the viewer id comes only from the session (`@CurrentUser()`); no request carries a user id. Subscriptions and requests are read with `customer_id = viewer` in the query; a creator's other customers are never reachable.
- **What a customer may learn:** public profile fields and the viewer's **own** access facts. No creator id or internal ids, no subscriber counts, no admin names, no review reasons, no other customers, no media. The Explore chip is the viewer's own state only.
- **Query contract** (`GET /v1/creators`, strict, snake_case; unknown key or value → 400): `page` (≥ 1, ≤ 100 000, default 1), `page_size` (`10|20|50`, default 20). Page past the end → `items: []` with the real `total`.
- **Code validation:** `by-code` keeps the US-005 rule (any malformed or unknown code is the same 404; no hint).
- **`access_requests`** (migration, read-only here): `id` uuid, `customer_id` → users (RESTRICT), `creator_id` → creators (RESTRICT), `type` enum `AccessRequestType` (TRIAL, RENEWAL), `status` enum `AccessRequestStatus` (PENDING, APPROVED, REJECTED; default PENDING), `reviewed_by_admin_id` → admin_accounts null (RESTRICT), `reviewed_at`, `review_reason` (≤ 300 chars), `created_at`, `updated_at`. CHECK ties the review fields to the status (as `creator_applications`). **Partial unique index** `(customer_id, creator_id) WHERE status = 'PENDING'`: one pending request per pair, enforced by the database (US-023 relies on it for idempotency). Indexes `(creator_id, status, created_at)` and `(customer_id, created_at)`.
- **Entitlement:** read from `subscriptions` with the shared rule; nothing is stored as a state, so there is no counter to drift.
- **Events / outbox / sockets / queues:** none (read-only).

## Dependencies

- Prior stories: US-005 (route, `CreatorLinkService`, `CreatorLinkPage`, creator explanation), US-020 / US-021 (subscriptions, `entitledSubscriptionSql`, `isEntitled`), US-007 / US-009 (profile with `timezone`, `formatDateTime`), US-002 (customer shell, `BottomNav`, `BottomToast`, `Avatar`, `StatusChip`-like chips of the Mini App).
- No packages, no env. One migration: `access_requests`. Seed: a pending TRIAL request from Raka Putra to Dinda (13 Nov 2026 10.42 WIB) so the three states of the `Explore` board (Salsa Aktif, Dinda Menunggu, Kirana Berakhir) show for him; his Salsa (active) and Kirana (expired) subscriptions already exist.
- Next free task ids after this plan: 133.

## Risks

- **Two screens disagreeing on the state:** one pure function used by both, tested against `isEntitled` and against `entitledSubscriptionSql`-based counts; the Explore list never recomputes in SQL.
- **Leaking media or internals in a response:** contract schemas are strict (an `id`, `status`, `media`, `gallery`, `subscriber_count` key is refused) and an API test scans every body for those words.
- **Stale state across the expiry boundary:** `now` is read once per request; tests use an injected clock at `ends_at` ± 1 s and at revocation.
- **Pending request for a creator that later became blocked:** Explore and profile only answer for ACTIVE creators, so the pending row is invisible, not an error.
- **Time zones:** dates are formatted with the viewer's stored zone; a test renders the same instant in `Asia/Jakarta` and `Australia/Sydney`.
- **Undesigned bits (placeholders, Known Gaps):** the Explore pagination control ("Muat lagi"), Explore empty / error / loading states, the profile loading and load-failed states, the "tap on a not-yet-built action" message, the category / city line, the active-state gallery placeholder wording. Copy placeholders are marked in `copy.ts`.
- **Moving `/creators/:publicCode` into the customer shell** (the boards show the bottom nav, the unavailable state is outside it): keep the route guards of US-005 (login, then the path survives) and the CREATOR explanation; router tests cover USER, CREATOR, signed-out and unavailable.

## Tasks

### TASK-127: Explore and profile access contracts

`packages/contracts/src/creator-access.ts` (+ spec, exported); extends `creator-link.ts`:

- `CreatorAccessSchema`: strict discriminated union on `state`: `{ state: 'GUEST' }`, `{ state: 'PENDING', requested_at, request_type: 'TRIAL' | 'RENEWAL' }`, `{ state: 'ACTIVE', ends_at }`, `{ state: 'EXPIRED', ended_at, revoked: boolean }`.
- `CreatorLinkResponseSchema` (US-005) gains `access: CreatorAccessSchema` (still strict: no ids, status or media).
- `ExploreQuerySchema` (strict; `page`, `page_size` 10 / 20 / 50, defaults), `ExploreItemSchema` `{ public_code, display_name, bio, avatar_url (https or null), access: 'ACTIVE' | 'PENDING' | 'EXPIRED' | null }`, `ExploreResponseSchema { items, total, page, page_size }`, `EXPLORE_PAGE_SIZES`.
- `EXPLORE_PATH = '/v1/creators'`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-access.ts`, `creator-access.spec.ts` | schemas, allowlists |
| MODIFY | `packages/contracts/src/creator-link.ts`, `creator-link.spec.ts`, `index.ts` | `access` on the by-code answer, export |

**Testing:** defaults; every allowlist refuses unknown values (page 0, "abc", size 15, extra key, repeated key); the union accepts each state with exactly its fields and refuses missing or foreign fields (`ends_at` on GUEST, `requested_at` on ACTIVE); strict objects refuse leaked keys (`id`, `creator_id`, `status`, `media`, `gallery`, `tiles`, `subscriber_count`); avatar must be https; the US-005 response tests still pass with `access` added.

---

### TASK-128: Migration: `access_requests` and seed

`packages/db/prisma/schema.prisma` + migration `20261124010000_access_requests`:

- Enums `AccessRequestType`, `AccessRequestStatus`; model `AccessRequest` → `access_requests` as in the rules above; relations on `User`, `Creator`, `AdminAccount`; the review-fields CHECK; the **partial unique index** and the two ordinary indexes (raw SQL in the migration for the partial one).
- Seed: Raka Putra → Dinda, TRIAL, PENDING, `created_at` 2026-11-13T03:42:00Z. Idempotent (the seed already upserts).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | model, enums |
| CREATE | `packages/db/prisma/migrations/20261124010000_access_requests/migration.sql` | tables, CHECK, partial unique index |
| MODIFY | `packages/db/seed/seed.ts`, `fixtures.ts`, `seed.int.spec.ts` | pending request fixture |

**Testing (db integration):** migration applies on the test DB; a second PENDING request for the same pair is refused (23505) while a PENDING plus an APPROVED / REJECTED one is allowed; two different pairs are independent; the review CHECK rejects a PENDING row with review fields and a REJECTED row without a reason; RESTRICT on user / creator / admin delete; seed twice leaves one row. Never `migrate reset` a database you did not create; dev DB: `pnpm db:migrate` only.

---

### TASK-129: `accessStateOf` and `CreatorAccessService`

`packages/backend-core/src/creator-access/`:

```ts
type AccessState =
  | { state: 'GUEST' }
  | { state: 'PENDING'; requestedAt: Date; type: 'TRIAL' | 'RENEWAL' }
  | { state: 'ACTIVE'; endsAt: Date }
  | { state: 'EXPIRED'; endedAt: Date; revoked: boolean }
export function accessStateOf(input: { subscription: { startsAt: Date; endsAt: Date; revokedAt: Date | null } | null; pending: { createdAt: Date; type: 'TRIAL' | 'RENEWAL' } | null }, now: Date): AccessState

class CreatorAccessService {
  constructor(prisma: PrismaClient, clock?: () => Date)
  explore(userId: string, query: ExploreQuery): Promise<ExploreResponse>
  profile(userId: string, code: string): Promise<{ kind: 'ok'; creator: …; access: AccessState } | { kind: 'not_found' }>
}
```

- `accessStateOf` is pure: ACTIVE when `isEntitled(subscription, now)`; else PENDING when `pending`; else EXPIRED when a subscription exists (`endedAt` = `revokedAt` when revoked, else `endsAt`); else GUEST.
- `explore`: one count + one page query over ACTIVE creators (creator and account ACTIVE) ordered by `lower(display_name), id`, then `subscriptions` and PENDING `access_requests` for the page's creator ids with `customer_id = userId`; map through `accessStateOf` (GUEST → `null` in the list). `profile` reuses `CreatorLinkService.resolve` (same not-found rules: unknown, malformed, blocked, inactive), then the viewer's subscription and pending request for that creator.
- Never selects media, counts or internal ids into the result.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-access/access-state.ts`, `access-state.spec.ts`, `creator-access.service.ts`, `creator-access.service.int.spec.ts`, `index.ts` | state function and service |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing:**
- *Pure:* every state; the precedence matrix (active + pending → ACTIVE; ended + pending → PENDING; ended only → EXPIRED; revoked → EXPIRED with `revoked`; none → GUEST); the boundary (`ends_at` = now → ended, `now` one ms before → ACTIVE); agrees with `isEntitled` over a grid of dates and revocation.
- *Integration (real PostgreSQL, injected clock):* explore lists only ACTIVE creators (blocked creator, blocked creator account and pending applications absent); order by name; page size and page; `total` independent of the page; a page past the end empty; chips for the viewer's own state only (another customer's subscription or request never affects it); the three states of the `Explore` board; profile for each state with the right dates (revoked uses `revoked_at`); an `ends_at` one second in the past → EXPIRED; pending request of another customer → GUEST; unknown, malformed, blocked creator → `not_found`; result keys carry no id, status or media.

---

### TASK-130: API endpoints and Mini App client

- `apps/api/src/modules/creators/creators.controller.ts`: add `GET /v1/creators` (query through `ZodValidationPipe(ExploreQuerySchema)`); `by-code` now returns the contract with `access` mapped from the service (ISO dates); both `@Roles('USER')`, `Cache-Control: no-store`; provider for `CreatorAccessService` in `creators.module.ts` / `tokens.ts` (keep `CreatorLinkService` for the bot).
- `apps/miniapp/src/auth/api-client.ts`: `listCreators(query, signal?)` and the extended `getCreatorByCode(code, signal?)` with response validation, the existing 401 handling, abort support; `fake-miniapp-api.ts` stubs with the board data.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/creators/creators.controller.ts`, `creators.module.ts`, `tokens.ts` | routes |
| MODIFY | `apps/api/test/creator-link.int.spec.ts` (+ `roles-declared` expectations) | updated shape |
| CREATE | `apps/api/test/explore.int.spec.ts` | API integration test |
| MODIFY | `apps/miniapp/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/miniapp/test/fake-miniapp-api.ts` | client calls |

**Testing (API integration, real app):** USER token → 200 on both routes with `no-store`; **CREATOR token → 403 `FORBIDDEN_ROLE`**, admin token and no token → 401; explore: only ACTIVE creators, the viewer's own chip, paging and 400 on every bad value (page 0, size 15, extra key); profile: each of the four states over HTTP (grant / revoke through the services, a pending request row), the identical 404 for unknown / malformed / blocked codes; **no media, ids, counts or other customers' data in any body** (scan of keys and values); the endpoints never write (row counts unchanged); an expired-a-minute-ago subscription answers EXPIRED. Client: URL building, validation, 401 handling, abort.

---

### TASK-131: Explore page

`apps/miniapp/src/explore/ExplorePage.tsx` + route `/explore` in the customer shell (replaces the placeholder; board `Explore`, 390×844, PNG + HTML):

- Title "Jelajahi creator", a card per item: avatar (initials fallback), name, bio excerpt (clamped to the board's lines), the access chip (**Aktif** check / **Menunggu** hourglass / **Berakhir** clock, icon + label, none for no relation), **Profil** button → `/creators/:publicCode`. Buttons never wrap; bio rendered as text.
- Server-paginated with a **"Muat lagi"** button appending the next page (placeholder control: the board shows no pagination, **design gap**); loading skeleton, empty ("Belum ada creator") and error + retry states (placeholders, **gaps**); a stale response never overwrites a newer one; a 401 follows the existing session-loss path.
- Chips update when returning from a profile (refetch on mount).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/explore/ExplorePage.tsx`, `explore.module.css`, `explore-copy.ts`, `useExplore.ts` | page |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `nav-config.ts` (if needed) | `/explore` route |
| CREATE | `apps/miniapp/src/explore/ExplorePage.spec.tsx` | component tests |
| MODIFY | `visual/specs/visual.spec.ts` | `Explore` screenshot |

**Testing:** cards, chips and copy per the board (Salsa Aktif, Dinda Menunggu, Kirana Berakhir; no chip for no relation); Profil navigates with the public code; "Muat lagi" appends and disappears at the end; loading / empty / error + retry; text as text (`<img>` in a bio creates no element); a CREATOR is redirected by the role gate (existing). Playwright at 390 px against `Explore`.

---

### TASK-132: Creator profile by access state

`apps/miniapp/src/creator-link/` (the deep-link page grows into the profile) + route `/creators/:publicCode` inside the customer shell for USER (the path still survives login, the CREATOR explanation and `StatesProfile` stay as built in US-005):

- **Header** (all states): avatar, name, bio (the boards' category / city line is omitted).
- **States** (exactly the one the server returns):
  - GUEST (`CreatorGuest`): "Minta Akses Uji Coba" + "Admin akan meninjau permintaanmu, lalu memberi kabar melalui Telegram."
  - PENDING (`CreatorPending`): "Permintaan akses terkirim", "Permintaan akses sudah dikirim. Kami akan memberi kabar melalui Telegram setelah disetujui.", "Dikirim 13 Nov 2026, 10.42 WIB" (viewer's zone), "Menunggu Persetujuan" (status, not an action). The board's DEMO strip is not built.
  - ACTIVE (`CreatorActive`): "Akses aktif hingga 27 Nov 2026", "Berakhir pukul 23.59 WIB", **Buka Chat**.
  - EXPIRED (`CreatorExpired`, also revoked): "Akses telah berakhir", "Sejak 6 Nov 2026, 23.59 WIB. Media yang sudah ada di chat tetap bisa dibuka.", **Minta Perpanjangan Akses**, **Lihat Riwayat Chat**.
- **Gallery section:** for GUEST / PENDING / EXPIRED only the "Galeri tersedia untuk subscriber aktif" panel with that state's sentence (no tiles, counts, durations or URLs: not even a locked grid); for ACTIVE a neutral placeholder (Phase D). The response has no media fields to render.
- **Action buttons** drawn per board; a tap shows the placeholder `BottomToast` ("Fitur ini belum tersedia.") until US-023 / US-026 / US-027 wire them; "Menunggu Persetujuan" is not tappable.
- **Dates** via `formatDateTime(value, profile.timezone)`; states loading (skeleton) and load-failed with retry are placeholders (**gaps**); a 404 → `StatesProfile` "Creator tidak tersedia" with **Jelajahi** → `/explore`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/creator-link/CreatorLinkPage.tsx`, `creator-link.module.css`, `creator-link.spec.tsx` | profile states |
| CREATE | `apps/miniapp/src/creator-link/CreatorProfileView.tsx`, `profile-copy.ts` (or extend the existing copy file) | state views, copy |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `apps/miniapp/src/auth/role-gating.spec.tsx` | route in the customer shell, gating tests |
| MODIFY | `visual/specs/visual.spec.ts`, `.agile/guidelines/design-integration.md`, `codebase-map.md` | four screenshots, gaps, built state |

**Testing:** component tests per state: board copy and buttons, the right dates in the viewer's zone (the same instant in `Asia/Jakarta` and `Australia/Sydney`), revoked shows the expired copy, gallery shows only the panel (no `img`, no counts, no durations, in every state), exactly one state is rendered, button taps show the placeholder toast and call no API, "Menunggu Persetujuan" does nothing; a 404 shows `StatesProfile` and Jelajahi navigates to `/explore`; a CREATOR still sees the US-005 explanation; a signed-out visit keeps the path through login; text as text. Playwright at 390 px against `CreatorGuest`, `CreatorPending`, `CreatorActive`, `CreatorExpired` (minus the omitted tile grid and category / city line; reviewed side by side, `refHeight` where the reference crop needs it).

---

## Implementation order

TASK-127 → TASK-128 → TASK-129 → TASK-130 → TASK-131 → TASK-132 (rebuild `contracts`, `db` and `backend-core` before the API and Mini App see them; run `pnpm db:migrate` on the dev database).

## Open inputs

- **Not designed (placeholders, Known Gaps):** Explore pagination ("Muat lagi"), Explore and profile loading / empty / error states, the "feature not available yet" message for buttons whose stories are not built, the category / city line (no data model), the ACTIVE-state gallery placeholder.
- **Buttons are inert until their stories:** Minta Akses Uji Coba / Minta Perpanjangan Akses (US-023), Buka Chat / Lihat Riwayat Chat (US-026, US-027).
- **Behaviour to announce at completion:** `by-code` now also returns the viewer's access state; Explore ordering is by name (the board does not say).
- At story completion (dev-team): `codebase-map.md` (endpoints, entity, routes, inventory), QA reports, `completed.json`, `sprint.json`.
