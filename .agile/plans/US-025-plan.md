# Technical Plan: US-025 — Customer Langganan page

> Task ids 143–146 (137–142 belong to US-024). Builds on US-022 (`accessStateOf`, `CreatorAccessService`, the profile and Explore chips), US-023 (`requestAccess`, `access_requests`), US-009 (`formatDateTime`, `zoneLabel`), US-002 (customer shell, `BottomNav`, `BottomToast`). The chat itself is US-026 / US-027: "Buka Chat" stays a placeholder until then.

## Architecture Overview

Agreed with the user (2026-11-17, recommended option): a creator that is now **blocked** still shows, with its real period, but with no buttons and a short note.

```
GET /v1/subscriptions        @Roles('USER') → CreatorAccessService.subscriptions(userId)   (Langganan)
/subscriptions               SubscriptionsPage (Subscriptions board; StatesChats pattern for loading / empty / error)
```

- **One state function.** The service reads the viewer's subscriptions and PENDING access requests (`customer_id = viewer` in the WHERE), takes the union of their creators, and passes each pair through `accessStateOf` (US-022), the same function the profile and Explore use, so the three screens cannot disagree. `now` is read once per request.
- **What is a relation:** a subscription row (a revoked one counts: it shows as Berakhir) or a PENDING request. A creator with only a REJECTED request is **not** listed (the board has no card for it); it is still reachable from Explore.
- **Order:** ACTIVE first (soonest `ends_at` first), then PENDING (oldest request first), then EXPIRED (most recently ended first); ties by display name, then public code. Fixed in the service, not the client. **No pagination:** capped at 100 rows (a customer's creator count is small; the board has no paging control). Over the cap the newest relations win and nothing else changes.
- **Blocked creators.** The creator row or its account is not ACTIVE → `creator_available: false`. The card keeps its state and dates (Aktif keeps "Akses aktif hingga …") but shows **no buttons** (Buka Chat, Profil and Minta Perpanjangan would all fail: the profile answers 404) and a placeholder note. No other data about the block (no reason, no status words) is sent.
- **Response (strict, snake_case):** `{ items: [{ public_code, display_name, avatar_url (https or null), access: CreatorAccess, creator_available }] }`. `CreatorAccess` is the US-022 union (`ACTIVE{ends_at}`, `PENDING{requested_at, request_type}`, `EXPIRED{ended_at, revoked}`; `GUEST` never appears). No ids, no counts, no media, no other customers. `no-store`, read-only.
- **Page actions** (all on the cards, reusing existing pieces):
  - **Aktif:** "Buka Chat" → placeholder toast ("Fitur ini belum tersedia.") until US-026 / US-027; "Profil" → `/creators/:publicCode`.
  - **Menunggu:** "Profil" only (the status is the chip, as on the profile).
  - **Berakhir:** "Minta Perpanjangan Akses" → the US-023 `requestAccess(code)` (one at a time, disabled with a sending label), then the list is refetched so the card turns Menunggu. 409 `ACCESS_ALREADY_ACTIVE` refetches; 404 `CREATOR_NOT_FOUND` refetches (the card shows as unavailable); any other failure shows an inline placeholder message under the button and the button stays usable.
- **Dates** use the viewer's account zone through `formatDateTime` / `zoneLabel` exactly as the profile does; the footer shows "Setiap creator punya periode akses sendiri. Semua waktu memakai <zone> (<offset>)." with the account's zone (the board's WIB / UTC+7 is the Jakarta rendering).
- **States:** loading (skeleton rows), empty, error with "Coba Lagi" use the `StatesChats` layout. Its text is chat-specific, so the Langganan wording is **placeholder copy** (reported as a gap).

Brief refs: §6, §10 (Langganan), §13. Design refs: `Subscriptions` (390×1690 incl. nav), `StatesChats` (layout of loading / empty / error), `StatesAccess` panel for the pending state wording already built. Gaps: the empty / error / loading copy, the blocked-creator note, the sending label and failure message of the extend button.

Out of scope: the chat, unread badge on the nav (US-030), filters or search on the page, cancelling a pending request, showing rejected requests.

## Authorization & Data Rules

- **Principal:** signed-in customers only: `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('USER')` (the `roles-declared` test keeps failing closed). CREATOR → 403 `FORBIDDEN_ROLE`; admin token, blocked account and no token → 401.
- **Scoping:** the viewer id comes only from the session; the request has no id and no parameters (any query string is ignored). Subscriptions and requests are read with `customer_id = viewer`; another customer's rows are unreachable by construction.
- **What a customer learns:** public profile fields (code, name, avatar) and their own access facts. A blocked creator's `creator_available: false` is the only hint, and it is about a creator the customer already holds or asked for.
- **Entitlement:** `ACTIVE` only through `accessStateOf` / `isEntitled` (not revoked, `starts_at <= now < ends_at`); a revoked subscription is EXPIRED with `revoked: true` at its revocation time; a `starts_at` in the future is not ACTIVE and not listed as one (treated as EXPIRED-less: see Risks).
- **Writes:** none here; the extend button reuses `POST …/access-requests` (US-023, its own rules and idempotency).
- **Events / outbox / sockets / queues:** none.

## Dependencies

- Prior stories: US-022 / US-023 (state function, submit endpoint, `requestAccess`), US-009 (date helpers), US-002 (shell, `BottomNav`, toast).
- No packages, no env, **no migration**. Seed: Raka Putra already has Salsa active, Dinda pending, Kirana expired (US-022), which are exactly the three cards of the board.
- Next free task ids after this plan: 147.

## Risks

- **Three screens disagreeing on a state:** one pure function; a test compares the list with the profile answer for every state.
- **A subscription that has not started yet** (`starts_at` in the future, only possible through a custom start): `accessStateOf` returns EXPIRED-or-GUEST for it today. The grant always starts now (US-020), so this cannot occur from the product; the service is tested to never list it as ACTIVE, and no special card is built.
- **Leaking a blocked creator's profile:** `creator_available: false` removes the Profil link; the API test scans bodies for status / id / reason words.
- **Slow or stale answers:** a newer load supersedes an older one (as in `useExplore`); the extend flow refetches instead of editing local state.
- **Undesigned bits (placeholders, marked in `copy.ts`):** empty / error / loading wording, the blocked-creator note, the sending label and failure message of the extend button.
- **Real Telegram untested.**

## Tasks

### TASK-143: Langganan contracts

`packages/contracts/src/creator-access.ts` (+ spec), extends US-022's file:

- `SUBSCRIPTIONS_PATH = '/v1/subscriptions'`.
- `SubscriptionItemSchema` (strict): `{ public_code, display_name, avatar_url (https or null), access: <ACTIVE | PENDING | EXPIRED variants of CreatorAccessSchema, no GUEST>, creator_available: boolean }`; `SubscriptionsResponseSchema` `{ items: SubscriptionItem[] }` (max 100).
- `SUBSCRIPTIONS_MAX = 100`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/creator-access.ts`, `creator-access.spec.ts` | item and response schemas, path, cap |

**Testing:** each state accepted with exactly its fields; `GUEST` refused; leaked keys refused (`id`, `creator_id`, `status`, `media`, `gallery`, `subscriber_count`, `review_reason`); avatar must be https; `creator_available` required; more than 100 items refused.

---

### TASK-144: `CreatorAccessService.subscriptions`

`packages/backend-core/src/creator-access/creator-access.service.ts`:

```ts
subscriptions(userId: string): Promise<SubscriptionsResult> // { items: SubscriptionCard[] }
interface SubscriptionCard { publicCode; displayName; avatarUrl: string | null; access: Exclude<AccessState, {state:'GUEST'}>; creatorAvailable: boolean }
```

- Load the viewer's subscriptions and PENDING requests with their creator (code, creator status, account status and profile fields) in two queries; build one entry per creator; `accessStateOf({subscription, pending}, now)`; drop `GUEST`; `creatorAvailable = creator.status === 'ACTIVE' && account.status === 'ACTIVE'`; sort ACTIVE (ends soonest) → PENDING (oldest first) → EXPIRED (ended most recently first), then name, then code; cap at 100 after sorting (newest relations kept by the order above for EXPIRED).
- Selects nothing beyond the card fields (no ids, no media, no counts).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/creator-access/creator-access.service.ts`, `creator-access.service.int.spec.ts` | the list |

**Testing (integration, real PostgreSQL, injected clock):** the three board cards for Raka (Salsa Aktif, Dinda Menunggu, Kirana Berakhir) in that order; order inside each group (two actives by end date, two pending by request time, two ended by end time, name tie-break); revoked → EXPIRED with `revoked` and its revocation time; precedence ACTIVE > PENDING > EXPIRED (ended + pending → PENDING); `ends_at` one second past → EXPIRED, one second before → ACTIVE; a creator with only a REJECTED or APPROVED-and-expired request does not appear unless a subscription exists; blocked creator and blocked creator account → listed with `creatorAvailable: false`; another customer's subscription or request never appears; a customer with no relation → `[]`; the list agrees with `profile()` for every listed creator; 101 relations → 100 items; result keys carry no id, status or media.

---

### TASK-145: API endpoint and Mini App client

- `apps/api/src/modules/creators/subscriptions.controller.ts` (module `CreatorsModule`): `GET /v1/subscriptions`, `@UseGuards(UserJwtGuard, RolesGuard)`, `@Roles('USER')`, `Cache-Control: no-store`, maps the service result to the contract (ISO dates); registered in `creators.module.ts`.
- `apps/miniapp/src/auth/api-client.ts`: `listSubscriptions(signal?)` with response validation and the existing 401 handling; `fake-miniapp-api.ts` gains `listSubscriptions` (default: the three board cards), `subscriptionCalls`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creators/subscriptions.controller.ts` | route |
| MODIFY | `apps/api/src/modules/creators/creators.module.ts` | register |
| CREATE | `apps/api/test/subscriptions.int.spec.ts` | API integration test |
| MODIFY | `apps/miniapp/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/miniapp/test/fake-miniapp-api.ts` | client |

**Testing (API integration, real app):** USER 200 with `no-store` and the exact contract; **CREATOR 403 `FORBIDDEN_ROLE`**, no token, admin token and blocked account 401; each state over HTTP (grant / revoke through the services, a pending request row); order as specified; blocked creator listed with `creator_available: false`; another customer's data never present (IDOR by two sessions); no ids / status / media / reason words in any body; query string ignored; the endpoint never writes (row counts unchanged); an expired-a-second-ago subscription answers EXPIRED. Client: URL, Bearer, validation (extra field refused), 401 handling, abort.

---

### TASK-146: Mini App Langganan page

`apps/miniapp/src/subscriptions/` (`SubscriptionsPage.tsx`, `useSubscriptions.ts`, `subscriptions-copy.ts`, `subscriptions.module.css`, specs); route `/subscriptions` inside the customer shell replaces the "belum dibangun" placeholder (CREATOR is still redirected, US-006).

- **Cards** from `Subscriptions.html` (copy values from the HTML): avatar disc (initials or https photo), name, chip (`StatusChip` active "Aktif" / pending "Menunggu" / expired "Berakhir"), the date line ("Akses aktif hingga 27 Nov 2026, 23.59 WIB" / "Diminta 13 Nov 2026, 10.42 WIB · menunggu persetujuan admin" / "Akses telah berakhir 6 Nov 2026, 23.59 WIB"), buttons per state as in the architecture section (never wrapping), footer text with the account's zone.
- **Unavailable creator:** state and dates as usual, no buttons, placeholder note; the card is not a link.
- **Extend flow:** one request at a time (ref guard, disabled with sending label), refetch after success / 409 / 404, inline message on other failures with the button enabled; "Buka Chat" shows the `BottomToast` placeholder.
- **States:** loading skeleton, empty (icon, title, text, "Jelajahi Creator" → `/explore`), error (icon, title, text, "Coba Lagi") in the `StatesChats` layout; heading "Langganan" in all states; nav shows Langganan active.
- A newer load supersedes an older one (generation counter); unmount cancels.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/subscriptions/SubscriptionsPage.tsx`, `useSubscriptions.ts`, `subscriptions-copy.ts`, `subscriptions.module.css`, `SubscriptionsPage.spec.tsx` | page |
| MODIFY | `apps/miniapp/src/app/routes.tsx` (+ `router.spec.tsx`) | route |
| MODIFY | `visual/specs/visual.spec.ts` | `Subscriptions` (390 px, nav included) and the three `StatesChats` layouts as informational items |

**Testing:** the three cards render in order with the right chip, date line, buttons and the footer zone label; dates in `Asia/Jakarta` vs `Australia/Sydney`; Profil links to `/creators/:code`; Buka Chat shows the info toast and calls no API; Minta Perpanjangan Akses sends once on a double tap, disabled while sending, then the card is Menunggu after the refetch; 409 / 404 refetch; other failure shows the inline message and the button works again; unavailable creator has no buttons and no link; empty, loading and error (retry) states; a hostile name renders as text; a CREATOR is redirected; a stale response never overwrites a newer one; no price / payment / checkout words in any state; Playwright at 390 px matches `Subscriptions` (copy, spacing, buttons not wrapping).

---

Order: TASK-143 → TASK-144 → TASK-145 → TASK-146 (rebuild `contracts` and `backend-core` before the API and Mini App see them; no `pnpm db:migrate` needed).
