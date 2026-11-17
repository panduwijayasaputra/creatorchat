# Technical Plan: US-028 — Creator inbox

## Architecture Overview

Vertical slice: contract → migration (last activity time and read cursors) → `CreatorInboxService` (backend-core) → `GET /v1/creator/inbox` → Mini App `/inbox` (`CrInbox` plus the four `CrStatesInbox` panels). Builds on the `messages` / `conversations` tables of US-026.

Brief refs: §4 (Inbox is the CREATOR landing tab), §7 (unread, cursor pagination), §10 (Inbox and filters per design). Design refs: `CrInbox` (390×844), `CrStatesInbox` (four phone frames in a 1740×960 board: loading, kosong, error, offline).

Decisions agreed with the user (2026-11-17):

| Topic | Decision |
|---|---|
| Unread | `conversation_reads` is created **now**; unread is computed from it. Nothing can move the cursor until US-030 adds the endpoint, so counts do not clear yet. |
| Which rows | Only conversations with at least one message (`last_message_at IS NOT NULL`) |
| Pagination | Keyset cursor on `(last_message_at, id)`, loads when the list scrolls to its end; no visible control |
| Offline panel | Built to the board and shown when the browser reports offline (`online` / `offline` events); US-031 later swaps the source for the socket state |

Defaults applied (flag if you disagree):

- **Not built (logged as gaps):** the "Cari nama pelanggan" search box (on the board, not in the story, same call as Explore); the Manual and Perlu Perhatian chips and the AI Aktif / Balasan AI gagal / Manual row chips (Phase F); the bottom-nav Inbox badge (US-030 owns the global badges).
- **Time column:** clock time (`09.20`) for today, `6 Nov` style for older days, as on the board. "Kemarin" is not designed.
- **"Akses berakhir" chip** shows whenever the customer is not currently entitled (expired, revoked, customer blocked, creator blocked), using the one entitlement rule.
- **"Belum Dibaca n"** counts conversations with unread messages (the board: 2 chips-count for badges 2 and 1), not messages.
- **Row tap** goes to `/inbox/:conversationId`, which US-029 builds. Until then a `NotImplemented` placeholder route holds that path.

## Authorization & Data Rules

- Route: `GET /v1/creator/inbox`, `@UseGuards(UserJwtGuard, RolesGuard)`, `@Roles('CREATOR')`. A USER token → 403 `FORBIDDEN_ROLE`; a blocked account → 401 (existing guards); `roles-declared.spec.ts` stays green.
- Scope comes from the session only: the creator row is looked up by `creators.user_id = session user`; every row is `conversations.creator_id = that creator`. There is no id in the request that selects a creator. A conversation of another creator can never match. No creator row → empty answer.
- Privacy of the answer: customer `display_name`, https `avatar_url`, the conversation id, a trimmed preview (first 120 characters of the last message, whitespace collapsed), `last_message_at`, `unread_count`, `access_active`. **No Telegram id, username, customer user id, or subscription dates.** No `mode` / `response_version` (Phase F).
- Unread (creator side): messages with `sender_user_id <> me` and `seq > coalesce(conversation_reads.last_read_seq, 0)`. Customer messages only, so the creator's own sends never count.
- Entitlement for the chip: `entitledSubscriptionSql(now)` inside an `EXISTS` subquery, with the outer query using different aliases than the helper's `s / cu / sc / ou`.
- Cursor: opaque base64url of `<last_message_at ISO>|<id>`; a malformed or tampered cursor → 400 (never an error 500). Keyset predicate `(last_message_at, id) < (cursor)`; `ORDER BY last_message_at DESC, id DESC`; fetch `limit + 1` to know whether more exist.
- `last_message_at` is written in the **same transaction** as the message (US-026's `ChatService.send`; US-029's creator send must do the same, noted there). It is never edited otherwise.
- Read-only endpoint; no outbox event, no socket event, no audit row. `Cache-Control: no-store`.

## Dependencies

- No new packages and no env vars. Reuses `entitledSubscriptionSql`, `ZodValidationPipe`, `AppError`, `CurrentUser`, the US-008 `GET /v1/creator/settings` (`bio_link`) and `copyToClipboard`, `BottomToast`, `BottomNav` / `CreatorShell`, `formatTime` / `formatDateTime`.
- Prior stories present: US-026 (`messages`, `ChatService`, seed chats), US-008 (bio link), US-009 (display timezone), US-006 (roles).
- Migration: new folder after `20261126010000`.

## Risks

- **Counts on every page:** the per-row unread count and the "Belum Dibaca n" total run per request. Mitigation: counts only for the page's rows (≤ 30) via the `(conversation_id, seq)` unique index; the total is one grouped query; revisit in Phase H if a creator has thousands of conversations.
- **Cursor stability:** ties on `last_message_at` are broken by `id`; a conversation that moves to the top between pages can appear twice across pages if it was already loaded: the client de-duplicates by conversation id and the first page refetch replaces the list.
- **Backfill:** existing conversations get `last_message_at` from their latest message in the migration (the seed and dev DB already hold chats).
- **Unread can't clear yet:** until US-030 the badges only grow. This is the agreed trade-off; the story notes it for UAT.
- **Design gaps (placeholder copy in one `inbox-copy.ts`, reported):** empty list under the Belum Dibaca filter, the missing search box, "Kemarin", failed "Salin Link Profil", the load-more failure, a row with a long name.

## Tasks

### TASK-154: Inbox contracts

`packages/contracts/src/creator-inbox.ts` (re-export from `index.ts`):

- `CREATOR_INBOX_PATH = '/v1/creator/inbox'`, `INBOX_PAGE_DEFAULT = 30`, `INBOX_PAGE_MAX = 50`.
- `InboxQuerySchema` (strict): `{ filter: 'all' | 'unread' (default 'all'), cursor?: string (1..200 chars), limit: int 1..50 (default 30) }`.
- `InboxItemSchema`: `{ conversation_id: uuid, customer: { display_name: string, avatar_url: string | null }, preview: string, last_message_at: string, unread_count: int ≥ 0, access_active: boolean }`.
- `InboxResponseSchema`: `{ items: InboxItem[], next_cursor: string | null, unread_conversations: int ≥ 0 }`.
- Pure cursor helpers `encodeInboxCursor(at: Date, id: string)` / `decodeInboxCursor(s): { at: Date, id: string } | null` (shared by the service and its tests; rejects bad base64, bad date, non-uuid).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-inbox.ts` | Schemas, path, cursor helpers |
| CREATE | `packages/contracts/src/creator-inbox.spec.ts` | Schema and cursor tests |
| MODIFY | `packages/contracts/src/index.ts` | Export |

**Testing:**
- Query defaults, `limit` 0 / 51, unknown key, bad `filter` → fail; a cursor over 200 chars fails.
- Cursor round-trip; garbage, a date that is not a date, a non-uuid id → `null`.
- Item shape: no key named `telegram_id`, `username`, `customer_id` can be added (strict parse of a sample).

---

### TASK-155: Schema, migration and send-path update

- `conversations.last_message_at timestamptz(3) NULL`; backfill `UPDATE conversations c SET last_message_at = (SELECT max(created_at) FROM messages m WHERE m.conversation_id = c.id)`.
- Index `conversations_creator_last_message_idx` on `(creator_id, last_message_at DESC, id DESC) WHERE last_message_at IS NOT NULL`.
- `model ConversationRead` → `conversation_reads`: `conversation_id` FK RESTRICT, `user_id` FK RESTRICT, `last_read_seq int NOT NULL DEFAULT 0` (CHECK ≥ 0), `updated_at`; `PRIMARY KEY (conversation_id, user_id)`. One row per participant, written by US-030 only.
- `ChatService.send` (US-026): the existing `UPDATE conversations SET last_message_seq = …` also sets `last_message_at = ${now}`; add a test assertion.
- Seed (`run-seed.ts`): set `lastMessageAt` to the last fixture message time when creating chat fixtures.
- Dev DB: `prisma migrate deploy`; never reset. Test DB through `prepareTestDatabase`. Add `conversation_reads` to the `identity-baseline` table allowlist.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | Column, model, relations |
| CREATE | `packages/db/prisma/migrations/20261127010000_inbox/migration.sql` | Column, backfill, index, table, CHECK |
| MODIFY | `packages/backend-core/src/chat/chat.service.ts` | Set `last_message_at` in the send transaction |
| MODIFY | `packages/backend-core/src/chat/chat.service.int.spec.ts` | Assert it |
| MODIFY | `packages/db/seed/run-seed.ts`, `seed.int.spec.ts` | Seed value |
| MODIFY | `packages/db/test/identity-baseline.int.spec.ts` | Table allowlist |
| CREATE | `packages/db/test/conversation-reads.int.spec.ts` | Constraint tests |

**Testing:**
- Backfill: a conversation with messages gets the latest `created_at`; one without stays NULL (test by running the migration SQL fragment on seeded rows, or an equivalent query test).
- Send sets `last_message_at = now`; a refused send leaves it unchanged.
- `conversation_reads`: duplicate (conversation, user) refused; negative `last_read_seq` refused; RESTRICT on delete.

---

### TASK-156: `CreatorInboxService` in backend-core

`packages/backend-core/src/creator-inbox/creator-inbox.service.ts` (+ `index.ts`, exported from the package index). Constructor `(prisma, clock = () => new Date())`.

```ts
list(creatorUserId: string, q: { filter: 'all' | 'unread'; cursor?: string | undefined; limit: number }):
  Promise<{ kind: 'ok'; items: InboxRow[]; nextCursor: string | null; unreadConversations: number } | { kind: 'bad_cursor' }>
```

- Resolve the creator by `creators.user_id`; none → `ok` with no items.
- One raw SQL projection: conversations of that creator with `last_message_at IS NOT NULL`, joined to the customer user, a `LEFT JOIN conversation_reads` for the creator's own user, the last message by `seq = last_message_seq` for the preview (collapse whitespace, `left(…, 120)`), the unread count and `access_active` (EXISTS with the entitlement helper). `filter = unread` adds `unread_count > 0`; cursor adds the keyset predicate; `LIMIT limit + 1`.
- `unreadConversations`: one grouped count over all of the creator's conversations, independent of `filter` and `cursor`.
- Avatar: `https` only (same helper rule as elsewhere), else `null`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-inbox/creator-inbox.service.ts` | Query and mapping |
| CREATE | `packages/backend-core/src/creator-inbox/index.ts` | Barrel |
| MODIFY | `packages/backend-core/src/index.ts` | Export |
| CREATE | `packages/backend-core/src/creator-inbox/creator-inbox.service.int.spec.ts` | Integration tests |

**Testing (real PostgreSQL):**
- Newest activity first; a new message moves a conversation to the top; conversations without messages are absent.
- Preview: long body cut at 120, newlines collapsed; the last message may be the creator's own.
- Unread: counts only customer messages after the cursor; `conversation_reads.last_read_seq` lowers it; the creator's own messages never count; `filter=unread` lists only those and `unreadConversations` still counts all.
- `access_active`: running → true; expired, revoked, no subscription, customer blocked, creator blocked → false.
- Pagination: pages of 2 over 5 conversations cover each once; stable when a message arrives between pages (no skip; the moved one may repeat only as the client expects); exact-fit last page has `nextCursor = null`; ties on the same `last_message_at` ordered by id.
- IDOR: creator B sees none of creator A's conversations; a USER id as `creatorUserId` → empty; a malformed or tampered cursor → `bad_cursor`.
- Output has no Telegram id, username or customer user id (assert on the keys).

---

### TASK-157: API endpoint

`GET /v1/creator/inbox` on the existing `CreatorController` (`@Controller('creator')`, `UserJwtGuard` + `RolesGuard`) or a new `CreatorInboxController` in the same module; `@Roles('CREATOR')`; `ZodValidationPipe(InboxQuerySchema)`; `@Header('Cache-Control', 'no-store')`.

- Maps `bad_cursor` → `AppError(VALIDATION_FAILED, 400, 'Invalid cursor.')`.
- Maps rows to `InboxResponse` (snake_case, ISO dates).
- Provider token `CREATOR_INBOX` in `tokens.ts`; module factory builds `CreatorInboxService(prisma.client)`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creator/creator-inbox.controller.ts` | Route |
| MODIFY | `apps/api/src/modules/creator/creator.module.ts`, `tokens.ts` | Provider and controller |
| CREATE | `apps/api/test/creator-inbox.int.spec.ts` | HTTP tests |

**Testing (real app):**
- No token 401; USER 403 `FORBIDDEN_ROLE`; blocked creator account 401.
- Creator A never sees creator B's rows; the answer holds no Telegram id / username / customer id (key assertion on the raw JSON).
- Strict query: unknown key, `limit=0|51`, `filter=manual` → 400; bad cursor → 400.
- Two pages via `next_cursor` cover every conversation once; `filter=unread` and `unread_conversations`; `no-store`.
- `roles-declared.spec.ts` passes.

---

### TASK-158: Mini App inbox data layer

`apps/miniapp/src/inbox/`:

- `api-client.ts` (`auth/`): `getCreatorInbox({ filter, cursor?, limit? }): Promise<InboxResponse>` parsed with the contract schema; added to `MiniappApi` and the fake API (`inboxResults` queue, `inboxCalls`).
- `useInbox(api, filter)`: loads page 1 for the filter (a new filter or retry supersedes the older load); `loadMore()` uses `next_cursor`, appends and **de-duplicates by `conversation_id`**; guarded against double calls; page-2 failure keeps the list and exposes `more: 'failed'`; refetches page 1 when the tab becomes visible again (replaces the list). Exposes `unreadConversations` from the latest answer.
- `useOnline()`: `navigator.onLine` plus `online` / `offline` events (the US-031 hook point).
- `inbox-model.ts`: `initialsOf(name)` (first letters of the first two words), `timeLabel(iso, zone, now)` (clock time today, `d MMM` otherwise), `avatarTone(conversationId)` (deterministic from the board palette).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts` | `getCreatorInbox` |
| MODIFY | `apps/miniapp/test/fake-miniapp-api.ts` | Fake and helpers |
| CREATE | `apps/miniapp/src/inbox/useInbox.ts` | Paging, filter, refetch |
| CREATE | `apps/miniapp/src/inbox/useOnline.ts` | Online state |
| CREATE | `apps/miniapp/src/inbox/inbox-model.ts` | Helpers |
| CREATE | `apps/miniapp/src/inbox/inbox-model.spec.ts`, `useInbox.spec.tsx` | Tests |

**Testing:**
- Initials (one word, two words, emoji, empty); time label today vs 6 Nov in two zones around midnight; avatar tone is stable per id.
- Hook: first page; `loadMore` appends once and ignores a second call while loading; duplicates from an overlapping page are dropped; page-2 failure keeps rows and reports `failed`; switching filter resets and a slow older answer never overwrites the newer one; visible-again refetch replaces the list.
- `useOnline` follows the events.

---

### TASK-159: Mini App inbox screen (`CrInbox`, `CrStatesInbox`)

Route `/inbox` inside the CREATOR shell (replaces the placeholder); `inbox/:conversationId` stays a `NotImplemented` placeholder for US-029. Per screen: PNG first, exact values from `CrInbox.html` and `CrStatesInbox.html`, React components with CSS modules, no pasted HTML.

- Title "Inbox"; filter chips **Semua** (selected: check icon) and **Belum Dibaca n** (n = `unread_conversations`; hidden count when 0 is not designed: show the label without a number); horizontally scrollable chip row.
- Row: avatar (https photo or initials on the tone), name, time, one-line preview with ellipsis, unread badge (rose circle, number), and the **Akses berakhir** chip (clock icon + label) when `access_active` is false. No AI / Manual chips. Rows are links to `/inbox/:conversationId` with a 44 px+ touch target and dividers as on the board.
- Loads more when the scroll area nears its end; no visible control.
- States (`CrStatesInbox`): loading skeleton rows; empty "Belum ada percakapan" + "Bagikan link profilmu di bio Instagram agar pelanggan bisa mulai chat." + **Salin Link Profil** (reads `bio_link` through `getCreatorSettings`, copies with `copyToClipboard`, toast on success; failure toast = placeholder); error "Inbox gagal dimuat" + "Terjadi gangguan saat mengambil percakapan. Coba lagi sebentar." + **Coba Lagi**; offline: the "Koneksi terputus" panel above the list with the rows dimmed, shown from `useOnline()`.
- Placeholders (reported): empty result under Belum Dibaca, page-2 failure, copy-link failure.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/inbox/InboxPage.tsx` | Screen and states |
| CREATE | `apps/miniapp/src/inbox/inbox.module.css` | Styles with exact board values |
| CREATE | `apps/miniapp/src/inbox/inbox-copy.ts` | All strings; placeholders marked |
| CREATE | `apps/miniapp/src/inbox/InboxPage.spec.tsx` | Component tests |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | `/inbox` real, `inbox/:conversationId` placeholder |
| MODIFY | `apps/miniapp/src/preview/*` | Preview entries if the visual harness needs them |

**Testing:**
- Rows render name, preview, time in the account zone, badge, and the "Akses berakhir" chip only when inactive; no AI / Manual text, no Telegram id in the DOM (assert).
- Filter chip: Belum Dibaca refetches with `filter=unread`; the count comes from the server.
- States: loading, empty (Salin Link Profil copies the server link once and shows the toast), error + Coba Lagi, offline panel appears on the `offline` event and disappears on `online`.
- Scrolling to the end loads the next page once; a USER session on `/inbox` is redirected by the role gate (existing spec covers the pattern).

---

### TASK-160: Visual check and docs

- Playwright (`visual/specs/visual.spec.ts`): `miniapp-inbox` at 390×844 against `CrInbox` (creator session, mocked answer with Rani, Bayu, Nadia; the AI chips, Manual chip and search box of the board are expected differences), plus the four `CrStatesInbox` frames (clip each phone; loading, empty, error, offline). Review the sheets side by side.
- Update `codebase-map.md` (entities `conversation_reads`, `last_message_at`; endpoint; route; feature backlog), `design-integration.md` Known Gaps, `tech-stack.md` decisions log (cursor format, unread source, offline source).
- Seed check: Raka's seeded message makes Salsa's inbox show one unread row locally.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/specs/visual.spec.ts` | Five comparisons |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `tech-stack.md` | Keep in sync |

**Testing:**
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; `pnpm visual -g miniapp-inbox` passes with the differences documented in the QA report.

---
