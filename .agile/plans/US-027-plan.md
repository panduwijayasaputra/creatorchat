# Technical Plan: US-027 — Customer chat list

> Task ids 161–166 (147–153 belong to US-026, 154–160 to US-028). Builds on US-026 (`messages`, `conversations.last_message_seq`, `chat-access.ts`, the `/chats/:conversationId` screen and its `chat-copy.ts`), US-022 / US-025 (profile and Langganan, whose "Buka Chat" buttons are placeholders until now), US-009 (`formatTime` / `formatDateTime`), US-002 (`CustomerShell`, `BottomNav`, `formatBadge`). Marking a chat as read, "Dibaca" and creator-side unread are US-030; realtime is US-031.

## Architecture Overview

Agreed with the user (2026-11-17, recommended options):

1. **`conversation_reads` is read here only.** The table (brief §13 `ConversationRead`: composite key `(conversation_id, user_id)`, `last_read_seq`) was created by US-028's migration `20261127010000_inbox`, planned in parallel; US-027 does **not** add a migration and computes customer unread from it. US-030 adds the write path (advance the cursor), receipts and the creator side. Until then opening a chat does not clear a badge; the seed supplies the board's "2" for Salsa.
2. **The links into the chat are wired now.** The by-code (profile) and `/subscriptions` answers gain the viewer's own `conversation_id` (or `null`), and "Buka Chat" / "Lihat Riwayat Chat" become links to `/chats/:conversationId`.

```
GET /v1/chats?cursor&limit      @Roles('USER') → ChatListService.list(userId, {cursor, limit})     (Chats, StatesChats)
GET /v1/chats/unread            @Roles('USER') → ChatListService.unreadTotal(userId)               (bottom-nav badge)
GET /v1/creators/by-code/:code, GET /v1/subscriptions   + conversation_id (own conversation or null)

/chats                  ChatListPage       (Chats; StatesChats loading / empty / error)
CustomerShell           UnreadProvider → BottomNav badge (fetch on mount, route change, tab visible)
```

- **One row per conversation of mine** (`conversations.customer_id = me`), including conversations whose access ended and those with a blocked creator (history is kept). A conversation that exists but has no message yet is listed too (access was granted): preview is a placeholder, activity time is the conversation's creation time. Newest activity first.
- **Row:** `{ conversation_id, public_code, display_name, avatar_url, last_message: { preview, at } | null, unread_count, access: 'ACTIVE' | 'EXPIRED' | 'CREATOR_BLOCKED' }`. `access` comes from the same `chat-access.ts` rule as the chat screen (a blocked creator wins; otherwise `isEntitled`), so the list and the chat cannot disagree. Strict contract: no creator id, no status words, no counts beyond `unread_count`, no message ids, no media.
- **Preview:** the last message's body with whitespace runs collapsed and cut to 120 characters **in SQL** (`left`), so the list never ships a 2000-character body. The board's "…" is CSS ellipsis. No sender prefix (the board has none).
- **Pagination:** keyset, newest activity first: `ORDER BY activity_at DESC, id DESC`, `LIMIT limit + 1`. `cursor` is an opaque base64url of `<activity ISO>|<conversation id>`, parsed strictly (anything else → 400 `VALIDATION_FAILED`); the response carries `next_cursor` or `null`. A cursor is only a comparison boundary applied inside the `customer_id = me` filter, so a forged one cannot reach another customer's rows. `limit` 10 / 20 / 50, default 20. New messages arriving between pages never duplicate or skip a row older than the boundary.
- **Unread:** `count(messages WHERE conversation_id = c.id AND sender_user_id <> me AND seq > coalesce(read.last_read_seq, 0))`. One grouped query per page (no per-row queries). `unreadTotal` is the same count over all my conversations, **including** expired and blocked-creator ones, in one query. Today only seed data has creator messages (creator sending is US-029).
- **Row display (Mini App):** time is `HH.mm` when the last activity is today in my account zone, else `6 Nov` (`formatTime` / `formatDateTime`); unread badge when `unread_count > 0` and the access is ACTIVE; for EXPIRED the chip "Akses telah berakhir" replaces the badge (board), for CREATOR_BLOCKED the US-026 placeholder "Creator tidak tersedia" replaces it; the badge shows `99+` above 99 (`formatBadge`).
- **Discovery card** "Cari creator lain · Lihat profil dan minta akses uji coba." → `/explore`.
- **States** (`StatesChats`, same layout as US-025): loading skeleton rows, empty ("Belum ada percakapan … Percakapan muncul di sini setelah kamu mendapat akses ke creator." + "Jelajahi Creator"), error ("Chat gagal dimuat … Terjadi gangguan saat mengambil percakapanmu. Coba lagi sebentar." + "Coba Lagi"). Copy is verbatim from the board.
- **Bottom-nav badge:** `UnreadProvider` in `CustomerShell` (and `CustomerFrame`, which shows the nav on the profile pages) calls `GET /v1/chats/unread` on mount, on every route change (throttled to once per 5 s) and when the tab becomes visible; a failure keeps the last value (no badge before the first success). The `unreadCount` prop that `createMiniappRoutes` already accepts stays as a test override.
- **Links:** `conversation_id` is the customer's own conversation (`customer_id = me`), never another's, `null` when none exists. Profile `CreatorActive` / the approved card "Buka Chat", the `CreatorExpired` "Lihat Riwayat Chat" and the Langganan "Buka Chat" link to `/chats/:conversationId`; with `null` they fall back to the existing info toast.

Brief refs: §4 (Chat is the USER landing tab), §7 (unread, timestamps), §10, §13 (`ConversationRead`). Design refs: `Chats` (390×844 incl. nav), `StatesChats` (loading / kosong / error panels, 1340×960 composite).

Out of scope: marking read, "Dibaca", realtime updates of the list (US-030 / US-031), creator inbox (US-028), search or filters on the list, muting, deleting a conversation.

## Authorization & Data Rules

- **Principal:** signed-in customers only: `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('USER')` (the `roles-declared` test keeps failing closed). CREATOR → 403 `FORBIDDEN_ROLE`; no token, admin token and blocked account → 401. `Cache-Control: no-store`, both endpoints read-only.
- **Scoping:** the viewer id comes only from the session; every SQL carries `customer_id = me`. `conversation_id` in answers is the viewer's own. The cursor cannot widen the scope (see above). Another customer's conversation never appears in the list, the count or the links.
- **What a customer learns:** their own conversations' ids, the public creator fields (code, name, avatar), the last message preview (their own conversation), unread counts and the access state. Nothing about the creator's status beyond `CREATOR_BLOCKED` for a conversation they already hold.
- **Entitlement:** `access` is derived on the server by `chat-access.ts` (US-026) from the subscription and the creator's status; nothing is stored. Sending stays gated by the US-026 send path.
- **`conversation_reads`** (US-028's migration): `conversation_id` → conversations (RESTRICT), `user_id` → users (RESTRICT), `last_read_seq` int ≥ 0 default 0 (CHECK), `updated_at`; primary key `(conversation_id, user_id)`. No row means cursor 0. The cursor can never exceed the conversation's `last_message_seq`: enforced by the US-030 writer (no cross-table CHECK here; noted as a rule for that story).
- **Idempotency / locks:** none (read-only). **Events / outbox / sockets / queues:** none.

## Dependencies

- Prior stories: US-026 (messages, chat access rule, chat screen), US-022 / US-025 (profile and Langganan answers), US-009, US-002.
- No packages, no env, **no migration** (the cursor table is US-028's). Depends on US-028's migration `20261127010000_inbox` being applied (`pnpm exec prisma migrate deploy`). Seed: Raka Putra's reads (Salsa cursor so that **2** creator messages are unread, Kirana cursor at her last message so 0) so the two rows of the `Chats` board show as drawn; the Salsa row's last message time is 09.14 in the account zone (fixture adjustment if the US-026 seed differs).
- Next free task ids after this plan: 167.

## Risks

- **Badge never clears until US-030** (no writer): accepted by the decision above; reported in UAT notes and the gap list so nobody mistakes it for a bug.
- **List and chat disagreeing on access:** one function (`chat-access.ts`); a test compares every row with the chat history's access state.
- **Cursor edge cases** (equal activity time, forged / malformed cursor, messages arriving mid-paging): tie-break by id, strict parsing, tests for each.
- **N+1 queries:** one page query with a lateral last-message join and one grouped unread count; a test asserts the statement count stays constant for 1 and 50 rows.
- **Nav badge cost and staleness:** one cheap count per route change, throttled; stale until the next navigation or visibility change (realtime is US-031).
- **Preview privacy / size:** cut in SQL to 120 characters; rendered as text, never HTML.
- **Contract change on US-022 / US-025 answers:** `conversation_id` is required-nullable; their specs, fakes and "no ids" scans are updated in the same task (the scans match whole keys, so `conversation_id` is deliberate and tested to be own-only).
- **Undesigned bits (placeholders, marked in `copy.ts`):** the "Muat lagi" control and its failure text, a conversation with no message yet ("Belum ada pesan"), the blocked-creator row chip (reuses US-026's wording).

## Tasks

### TASK-161: Chat list contracts

`packages/contracts/src/chat.ts` (+ spec), `creator-access.ts` (+ spec):

- `CHAT_LIST_PAGE_SIZES = [10, 20, 50]`, `CHAT_LIST_DEFAULT = 20`, `CHAT_PREVIEW_MAX = 120`, `chatListPath = '/v1/chats'`, `chatUnreadPath = '/v1/chats/unread'`.
- `ChatListQuerySchema` (strict, snake_case): `cursor` (optional, base64url ≤ 200 chars, validated by the service), `limit` (`10|20|50`, default 20); unknown or repeated keys → 400.
- `ChatListItemSchema` (strict): `{ conversation_id: uuid, public_code, display_name, avatar_url (https or null), last_message: { preview: string (≤ 120), at: ISO } | null, unread_count: int ≥ 0, access: ChatAccessState }`; `ChatListResponseSchema { items, next_cursor: string | null }`; `ChatUnreadResponseSchema { unread_total: int ≥ 0 }`.
- `CreatorProfileResponseSchema` (US-022) and `SubscriptionItemSchema` (US-025) gain `conversation_id: z.uuid().nullable()` (required).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/contracts/src/chat.ts`, `chat.spec.ts` | list, unread, query |
| MODIFY | `packages/contracts/src/creator-access.ts`, `creator-access.spec.ts` | `conversation_id` on profile and Langganan |

**Testing:** defaults; limit allowlist (0, 15, 51, "abc", repeated) refused; unknown query keys refused; each item field required; leaked keys refused (`creator_id`, `status`, `customer_id`, `message_id`, `media`, `body`); preview over 120 refused; non-https avatar refused; `unread_total` ≥ 0; `conversation_id` must be a uuid or null on the two older contracts, and their existing cases still pass with the new field.

---

### TASK-162: Customer read cursors: seed and constraint tests (no migration)

The `conversation_reads` table and the Prisma model `ConversationRead` already exist (US-028's migration `20261127010000_inbox`: `PRIMARY KEY (conversation_id, user_id)`, `last_read_seq int NOT NULL DEFAULT 0`, CHECK ≥ 0, FKs RESTRICT). This task only adds what US-027 needs on top, without touching the migration:

- Seed: Raka Putra's cursors (customer side): Salsa so that **2** creator messages are after the cursor, Kirana at her last message (0 unread); idempotent upserts keyed by `(conversationId, userId)`; the Salsa fixture's last message is at 09.14 in the account zone if the US-026 seed differs.
- A db integration spec for the customer-side use of the table (the constraints themselves belong to US-028's tests; do not duplicate them).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/seed/seed.ts`, `fixtures.ts`, `seed.int.spec.ts` | Raka's cursors (merge carefully with US-028's seed edits) |

**Testing (db integration):** seed twice leaves one row per (conversation, user); Raka's Salsa unread is 2 and Kirana's 0 by the plan's formula (customer messages never count, creator messages after the cursor do); a customer without a row counts every creator message as unread. Run nothing destructive on a database you did not create.

---

### TASK-163: `ChatListService`, `conversation_id` on profile and Langganan

`packages/backend-core/src/chat/chat-list.service.ts` (+ export), `creator-access/creator-access.service.ts`:

```ts
class ChatListService {
  constructor(prisma: PrismaClient, clock?: () => Date)
  list(userId: string, query: { cursor?: string; limit: number }): Promise<{ kind: 'ok'; items: ChatListRow[]; nextCursor: string | null } | { kind: 'bad_cursor' }>
  unreadTotal(userId: string): Promise<number>
}
```

- `list`: one SQL page (conversations of `customer_id = userId`, `LEFT JOIN LATERAL` last message with `left(regexp_replace(body, '\s+', ' ', 'g'), 120)`, activity = last message time or creation time, keyset `(activity, id) < cursor`, `ORDER BY activity DESC, id DESC LIMIT limit + 1`), then one grouped unread count and one subscription / creator-status lookup for the page's conversations; `access` via `chat-access.ts`; `nextCursor` from the last returned row when an extra row existed. Cursor parse: base64url → `<ISO>|<uuid>` with strict regexes, else `bad_cursor`.
- `unreadTotal`: one grouped count across all of the user's conversations.
- `CreatorAccessService.profile` returns `conversationId` and `subscriptions()` each card's `conversationId` (the viewer's own conversation or null, one extra query each, no per-row queries).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/chat/chat-list.service.ts`, `chat-list.service.int.spec.ts`, `chat-cursor.ts`, `chat-cursor.spec.ts` | list, count, cursor |
| MODIFY | `packages/backend-core/src/chat/index.ts`, `creator-access/creator-access.service.ts` (+ int spec) | export, conversation id |

**Testing (integration, real PostgreSQL, injected clock):**
- *List:* the two board rows (Salsa with 2 unread and the 09.14 message, Kirana expired with 0) in order; empty account → `[]`; a conversation without messages is listed with `last_message: null` and ordered by creation time; ordering by activity with an id tie-break; preview is whitespace-collapsed and at most 120 characters; expired, revoked and blocked-creator conversations are listed with the right `access` (blocked wins); another customer's conversations never appear (two customers); `access` equals the access state of the chat history for every row.
- *Paging:* page 1 then page 2 by cursor covers every row exactly once; a message arriving between the pages (the top row changes) causes no duplicate or skip of older rows; equal activity times split correctly; forged, malformed, wrong-length and non-ISO cursors → `bad_cursor`; a cursor naming another customer's conversation id returns only my rows.
- *Unread:* only the other participant's messages count; cursor row missing = 0; cursor at the last seq = 0; own messages never count; `unreadTotal` equals the sum of the rows and includes expired and blocked-creator conversations; a 99+ case.
- *Query count:* the number of statements for 1 and 50 conversations is the same.
- *Profile / Langganan:* `conversationId` is the viewer's own (never another customer's) or null; matches the id in the list.

---

### TASK-164: API endpoints and Mini App client

- `apps/api/src/modules/chat/chat-list.controller.ts` (module `ChatModule`, route prefix `chats`): `GET /v1/chats` (`ZodValidationPipe(ChatListQuerySchema)`, `bad_cursor` → 400 `VALIDATION_FAILED`) and `GET /v1/chats/unread`; both `@UseGuards(UserJwtGuard, RolesGuard)`, `@Roles('USER')`, `no-store`; the routes are declared so `GET /chats/unread` is not captured by `/chats/:conversationId/...`.
- `creators.controller.ts` (by-code) and `subscriptions.controller.ts` map `conversation_id`.
- `apps/miniapp/src/auth/api-client.ts`: `listChats(query, signal?)`, `getChatUnread(signal?)` with response validation, the existing 401 handling and abort; the existing responses are validated with the new field; `fake-miniapp-api.ts` stubs (default list: the two board rows; default unread 2) and `conversation_id` on its default profile and subscriptions.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/chat/chat-list.controller.ts` | routes |
| MODIFY | `apps/api/src/modules/chat/chat.module.ts`, `tokens.ts`, `apps/api/src/modules/creators/creators.controller.ts`, `subscriptions.controller.ts` | provider, mapping |
| CREATE | `apps/api/test/chat-list.int.spec.ts` | API integration test |
| MODIFY | `apps/api/test/explore.int.spec.ts`, `access-request.int.spec.ts`, `subscriptions.int.spec.ts` | `conversation_id` expectations |
| MODIFY | `apps/miniapp/src/auth/api-client.ts`, `api-client.spec.ts`, `apps/miniapp/test/fake-miniapp-api.ts` | client |

**Testing (API integration, real app):** USER 200 on both routes with `no-store` and the exact contracts; **CREATOR 403 `FORBIDDEN_ROLE`**, no token, admin token and blocked customer 401; bad `limit` / cursor / extra key / repeated key → 400; paging by cursor over HTTP; **IDOR:** two sessions never see each other's rows, counts or conversation ids; `conversation_id` on by-code and `/subscriptions` equals the list's id and is null without a conversation; no creator id, status, message id or full body in any response (key and value scan); the endpoints never write (row counts unchanged); `GET /v1/chats/unread` is not treated as a conversation id. Client: URLs and query building, validation (extra field refused), 401 handling, abort.

---

### TASK-165: Mini App chat list (`Chats`, `StatesChats`)

`apps/miniapp/src/chats/` (`ChatListPage.tsx`, `useChatList.ts`, `chat-list-copy.ts`, `chat-list.module.css`, specs); route `/chats` inside the customer shell replaces the placeholder.

- **Rows** from `Chats.html` (copy values from the HTML): avatar disc (initials or https photo), name, preview (one line, CSS ellipsis; placeholder "Belum ada pesan" when there is none), time, badge or chip as in the rules, divider between rows; each row is a link to `/chats/:conversationId` (the whole row is the tap target, at least 44 px). Time formatting uses the account zone (`HH.mm` today, `6 Nov` otherwise).
- **Discovery card** "Cari creator lain" → `/explore`.
- **Paging:** the first page loads on mount; "Muat lagi" (placeholder control as on Explore) loads the next page by cursor, appends, de-duplicates by conversation id, and keeps the rows on screen when it fails.
- **States:** loading skeleton rows, empty and error panels exactly as `StatesChats` (the title stays "Chat"), retry reloads; a newer load supersedes an older one.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/chats/ChatListPage.tsx`, `useChatList.ts`, `chat-list-copy.ts`, `chat-list.module.css`, `ChatListPage.spec.tsx` | page |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `router.spec.tsx` | route, landing test |
| MODIFY | `visual/specs/visual.spec.ts` | `Chats` (390 px, nav included) and the three `StatesChats` panels |

**Testing:** the two board rows in order with name, preview, `09.14` / `6 Nov`, the badge "2" and the "Akses telah berakhir" chip (no badge on that row); today vs older in `Asia/Jakarta` and `Australia/Sydney`; a blocked-creator row shows the placeholder chip; an empty conversation shows "Belum ada pesan"; row links point at `/chats/:id`; the discovery card goes to `/explore`; loading, empty (button goes to `/explore`) and error (retry) states; "Muat lagi" appends without duplicates and a failed page keeps the list with a retry; a hostile name or preview renders as text; a CREATOR is redirected to `/inbox`; `/` still lands a USER on `/chats`; no AI / manual wording anywhere; Playwright at 390 px matches `Chats` and each `StatesChats` panel.

---

### TASK-166: Bottom-nav unread badge and the links into the chat

- **`UnreadProvider`** (`apps/miniapp/src/chats/UnreadProvider.tsx`, `useUnread`): holds the total; fetches `getChatUnread` on mount, on route change (throttled to once per 5 s) and on `visibilitychange` to visible; aborts on unmount; keeps the last value on failure; `CustomerShell` and `CustomerFrame` pass it to `BottomNav` (the `unreadCount` prop stays an override for tests).
- **Links:** `CreatorProfileView` ("Buka Chat" on the active state and the approved card, "Lihat Riwayat Chat" on the expired state) and `SubscriptionsPage` ("Buka Chat") become links to `/chats/:conversationId` when `conversation_id` is present, else keep the info toast; the placeholder copy `notYet` stays for that fallback only.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/chats/UnreadProvider.tsx`, `UnreadProvider.spec.tsx` | badge data |
| MODIFY | `apps/miniapp/src/components/shell/Shells.tsx`, `routes.tsx` | provider and nav |
| MODIFY | `apps/miniapp/src/creator-link/CreatorProfileView.tsx`, `CreatorLinkPage.tsx`, `apps/miniapp/src/subscriptions/SubscriptionsPage.tsx` (+ their specs) | links |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md` | docs, gaps |

**Testing:** the nav badge shows the server total (`2`), `99+` above 99, nothing at 0; it refetches on route change (not more than once per 5 s) and when the tab becomes visible; a failed fetch keeps the old number; no fetch for a CREATOR; "Buka Chat" (profile, approved card, Langganan) and "Lihat Riwayat Chat" navigate to `/chats/:conversationId`, and fall back to the toast when `conversation_id` is null; existing profile and Langganan specs updated for the new field.

---

Order: TASK-161 → TASK-162 → TASK-163 → TASK-164 → TASK-165 → TASK-166 (rebuild `contracts`, `db` and `backend-core` before the API and Mini App see them).
