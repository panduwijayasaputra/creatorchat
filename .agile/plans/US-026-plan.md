# Technical Plan: US-026 — Customer private chat: read history and send text

## Architecture Overview

Vertical slice, built contract → schema → domain service → API → Mini App. First story of the Phase C chat; it creates the `messages` table that US-027..US-031 (list, creator inbox/reply, read receipts, realtime) build on.

Brief refs: §6 (send needs active access; history stays readable), §7 (one conversation per pair, text only, cursor pagination, sending/failed/retry, `client_message_id`), §14 (HTTP write path, outbox), §15, §17. Design refs: `Chat` (390×844), `ChatExpired` (390×844), `StatesAccess` → "Chat · riwayat loading" (frame inside the 1340×960 board; screenshot the frame only).

Decisions agreed with the user (2026-11-17):

| Topic | Decision |
|---|---|
| Text limit | 2000 characters (Unicode code points) after trim; 1–2000 else 400 |
| Entry point | Direct route `/chats/:conversationId` only. Links into it (chat list, "Buka Chat" on the profile) are US-027. Tests and manual runs use seeded conversation ids |
| Pagination | Keyset on a per-conversation `seq` (`?before=<seq>&limit=30`), newest page first |
| Creator blocked | History readable; composer replaced by the `ChatExpired` pattern with **placeholder copy and no renewal button**; reported as a design gap |

Further decisions in this plan (flag if you disagree):

- **Retrying the same `client_message_id` returns the stored message even if access has since ended.** The first send was legitimate; a replay must be idempotent, not a new check. Same id with different text → 409 `IDEMPOTENCY_CONFLICT`.
- **`conversations.last_message_seq` is the per-conversation counter.** Incrementing it under the conversation row lock gives gap-free ordering and serializes concurrent sends. US-029 and the AI commit lock the same row.
- **No read ticks ("Dibaca" / ✓✓).** Those belong to US-030; this story shows only the time on my bubbles. The board's double tick is not rendered yet.
- **No realtime and no polling.** A reply from the creator appears on the next open or refetch; US-031 adds sockets. The screen refetches the newest page when the tab becomes visible again (cheap, no new endpoint).
- **Unsent (pending/failed) bubbles live in memory only.** A reload loses them; nothing is half-stored on the server.

## Authorization & Data Rules

- Routes: `@Controller('chats')`, `@UseGuards(UserJwtGuard, RolesGuard)`, `@Roles('USER')`. A CREATOR token → 403 `FORBIDDEN_ROLE`; an own-account block → 401 (existing guard behaviour); the `roles-declared.spec.ts` walk must stay green.
- Caller id comes from the session only. Every query is scoped by `conversations.customer_id = me`: `findFirst({ id, customerId: me })`, no `findUnique({id})` then a check. Wrong owner, unknown id and malformed id all return the same 404 `NOT_FOUND`.
- Send, inside one transaction:
  1. `SELECT … FROM conversations WHERE id = $1 AND customer_id = $me FOR UPDATE` (404 if none).
  2. Look up `(conversation_id, sender_user_id, client_message_id)`; found → same body: return it (HTTP 200); different body: 409.
  3. Entitlement with the existing `entitledSubscriptionSql` (window, customer ACTIVE USER, creator and creator's user ACTIVE). Refusal codes, nothing stored: `CHAT_ACCESS_EXPIRED` (expired, revoked or no subscription) → 403; `CHAT_CREATOR_BLOCKED` → 403. A blocked customer never gets here (401).
  4. `UPDATE conversations SET last_message_seq = last_message_seq + 1, updated_at = now() … RETURNING last_message_seq`; insert the `messages` row; `OutboxService.add` with type `message.created`, aggregate `message`, dedupe key `message:<id>:created`, payload ids only (`message_id`, `conversation_id`, `sender_id`). **No body in the payload** (the service refuses free text anyway). Return 201.
- Uniqueness backstops: `UNIQUE (conversation_id, seq)` and `UNIQUE (conversation_id, sender_user_id, client_message_id)`.
- Access state in the history header (server-derived, the UI is never the authority): `ACTIVE` when entitled; `CREATOR_BLOCKED` when the creator or their account is BLOCKED (wins over a running subscription); otherwise `EXPIRED`. `ended_at` for EXPIRED = the earlier of `ends_at` and `revoked_at`.
- Response shape never exposes user ids, creator ids, session data or `sender` ids: each message carries only `sender: 'ME' | 'CREATOR'`. No AI/Manual field anywhere (customers never see it; `mode` is not selected).
- Responses `Cache-Control: no-store`.
- Events: only the committed outbox row; no socket emit here (US-031). No handler consumes `message.created` yet (same as `subscription.granted`, which the worker already tolerates).

## Dependencies

- No new packages. Reuses `OutboxService`, `entitledSubscriptionSql`, `AppError`, `ZodValidationPipe`, `UserJwtGuard` / `RolesGuard`, Mini App `formatTime` / `formatDateTime`, the US-023 access-request call for the "Minta Perpanjangan Akses" button.
- Prior stories present per codebase-map: US-006 (roles), US-009 (timezone), US-020 (conversation created on first grant; seed has Raka → Salsa and the expired Raka → Kirana subscription), US-022/023 (profile and access request).
- Migration: new timestamped folder after `20261125010000`.
- No new env vars.

## Risks

- **Concurrent sends and double taps.** Mitigation: conversation row lock + the two unique constraints; int test sends 10 in parallel with the same id and with different ids.
- **Seed conversation may not exist for every pair** (conversations are created by the first grant). Mitigation: TASK-153 checks the seed and adds the conversation and messages for the Raka ↔ Salsa and Raka ↔ Kirana fixtures.
- **Pagination stability.** Mitigation: keyset on `seq`, test inserts messages between page requests.
- **Spam from one account.** Reuse the Redis limiter helper used for access requests if it is reusable as is (30 sends/min per user → 429 `RATE_LIMITED`); if it is not, skip it and note it for Phase H instead of inventing one.
- **Design gaps (report, do not invent):** creator-blocked state copy; send failure for access/validation errors; day-separator label for another year; "Memuat riwayat…" while paging older history; empty conversation state. All placeholder copy sits in one `chat-copy.ts`.

## Tasks

### TASK-147: Chat contracts and error codes

`packages/contracts/src/chat.ts` (re-export from `index.ts`) with Zod schemas and inferred types:

- `CHAT_TEXT_MAX = 2000`.
- `SendMessageBodySchema` (strict): `{ client_message_id: uuid, body: string }`; the string is trimmed, then 1..2000 code points (`[...s].length`); empty or whitespace-only → "Pesan tidak boleh kosong." Unknown keys (`sender`, `user_id`, `conversation_id`) → 400.
- `ChatHistoryQuerySchema` (strict): `{ before?: int ≥ 1, limit?: int 1..50 (default 30) }` coerced from the query string; anything unknown → 400.
- `ChatMessageSchema`: `{ id: uuid, client_message_id: uuid, seq: int, sender: 'ME' | 'CREATOR', type: 'TEXT', body: string, created_at: ISO string }`.
- `ChatHistoryResponseSchema`: `{ conversation: { id, creator: { public_code, display_name, avatar_url | null }, access: { state: 'ACTIVE' | 'EXPIRED' | 'CREATOR_BLOCKED', ends_at | null, ended_at | null } }, items: ChatMessage[] /* newest first */, next_before: int | null }`.
- `SendMessageResponseSchema`: `{ message: ChatMessage }`.
- Add to `ErrorCode`: `CHAT_ACCESS_EXPIRED`, `CHAT_CREATOR_BLOCKED`, `IDEMPOTENCY_CONFLICT` (extend `errors.spec.ts` if it enumerates the list).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/chat.ts` | Schemas and types above |
| CREATE | `packages/contracts/src/chat.spec.ts` | Schema tests |
| MODIFY | `packages/contracts/src/errors.ts` | Three new codes |
| MODIFY | `packages/contracts/src/index.ts` | Export |

**Testing:**
- Body: trims; empty / whitespace → error; 2000 passes, 2001 fails; 2000 emoji counted as code points; non-uuid id fails; unknown key fails.
- Query: defaults, `limit` 0 / 51 / `before` 0 / `before=abc` fail, unknown key fails.
- Error codes are unique and parse through `ErrorCodeSchema`.

---

### TASK-148: Prisma schema and migration for messages

- Enum `MessageType { TEXT }` (Phase D adds MEDIA).
- `model Message` → `messages`: `id uuid` (gen_random_uuid), `conversation_id` FK RESTRICT, `sender_user_id` FK users RESTRICT, `type MessageType` default TEXT, `body text NOT NULL`, `client_message_id uuid NOT NULL`, `seq int NOT NULL`, `created_at timestamptz(3)`.
- CHECK `char_length(body) BETWEEN 1 AND 2000`.
- `UNIQUE (conversation_id, seq)`, `UNIQUE (conversation_id, sender_user_id, client_message_id)`, index `(conversation_id, seq DESC)` (covered by the first unique; add only if the planner needs it).
- `conversations.last_message_seq int NOT NULL DEFAULT 0`.
- Hand-edit the generated migration for the CHECK. `messages` is append-only for body (no UPDATE trigger needed now; later stories add `read_at` through a separate table).
- Dev DB only: `pnpm db:migrate`; never reset. Integration tests use `DATABASE_URL_TEST`. Update `resetDatabase` (packages/db testing helper) to truncate `messages` before conversations if it lists tables.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | `Message`, `MessageType`, `Conversation.lastMessageSeq` + relation |
| CREATE | `packages/db/prisma/migrations/20261126010000_messages/migration.sql` | Table, constraints, column |
| MODIFY | `packages/db/src/testing*` (the `resetDatabase` helper) | Clean the new table |

**Testing:**
- DB-level int test (in `packages/db/test` or backend-core): duplicate `(conversation, seq)` and duplicate `(conversation, sender, client id)` rejected; empty body and 2001-char body rejected by the CHECK; deleting a user or conversation with messages is blocked (RESTRICT).

---

### TASK-149: `ChatService` in backend-core (history + send)

`packages/backend-core/src/chat/chat.service.ts` (+ `index.ts`, exported from the package index). Constructor `(prisma, outbox: OutboxService, clock = () => new Date())`, same style as `AccessRequestService`.

```ts
history(customerId: string, conversationId: string, q: { before?: number; limit: number }): Promise<ChatHistory>
send(customerId: string, conversationId: string, input: { clientMessageId: string; body: string }): Promise<{ kind: 'created' | 'replayed'; message: StoredMessage }>
```

- Domain errors (thrown as plain classes the controller maps): `ConversationNotFoundError`, `ChatAccessExpiredError`, `ChatCreatorBlockedError`, `IdempotencyConflictError`.
- `history`: scoped `findFirst` (404), read the access state (see rules), then `messages WHERE conversation_id = $1 AND seq < $before ORDER BY seq DESC LIMIT limit + 1`; the extra row decides `next_before` (= the smallest returned `seq`, or null). Sender mapped to `ME` / `CREATOR` by `sender_user_id = customerId`. Does not select `mode` or `response_version`.
- `send`: the transaction exactly as in "Authorization & Data Rules"; re-trims and re-validates the body even though the contract did. Pure helper `chatAccessState(row, now)` is unit-tested separately.
- Export the shared access-state helper so US-029 (creator side) can reuse it.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/chat/chat.service.ts` | History and send |
| CREATE | `packages/backend-core/src/chat/chat-access.ts` | `chatAccessState` pure helper |
| CREATE | `packages/backend-core/src/chat/index.ts` | Barrel |
| MODIFY | `packages/backend-core/src/index.ts` | Export `chat` |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | `MESSAGE_CREATED: 'message.created'` |
| CREATE | `packages/backend-core/src/chat/chat-access.spec.ts` | Unit tests |
| CREATE | `packages/backend-core/src/chat/chat.service.int.spec.ts` | Integration tests |

**Testing:**
- Unit (`chatAccessState`): running → ACTIVE; `ends_at` exactly now → EXPIRED; revoked → EXPIRED with `ended_at = revoked_at`; creator BLOCKED or creator user BLOCKED → CREATOR_BLOCKED even when the subscription runs; not-yet-started subscription → EXPIRED.
- Integration: send creates one message, seq 1 then 2, one outbox event (`message.created`, ids only, no body); retry with the same id → `replayed`, same row, still one message and one outbox row; same id with different text → conflict, nothing changed; 10 parallel sends with the same id → one row; 10 parallel with different ids → seq 1..10 without gaps or duplicates; expired / revoked / no subscription → `ChatAccessExpiredError` with nothing stored; creator blocked → `ChatCreatorBlockedError`; a replay after expiry still returns the stored message; a failed send leaves `last_message_seq` unchanged (rollback).
- IDOR: another customer's conversation id, a conversation id of someone else's pair, and an unknown uuid all → not found, nothing stored.
- History: newest first; `next_before` null on the last page; `before` pages are stable when 3 new messages are inserted between page requests (no duplicate, no skipped row); expired and creator-blocked conversations remain readable; a body of 2000 characters round-trips.

---

### TASK-150: API endpoints

`apps/api/src/modules/chat/` (module, controller, `tokens.ts` with `CHAT_SERVICE`, wired in `AppModule`), same pattern as `creators`:

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/v1/chats/:conversationId/messages` | `UserJwtGuard` + `RolesGuard`, `@Roles('USER')` | `ZodValidationPipe(ChatHistoryQuerySchema)`; 200 `ChatHistoryResponse`; `no-store` |
| POST | `/v1/chats/:conversationId/messages` | same | `ZodValidationPipe(SendMessageBodySchema)`; 201 new, 200 replay; `no-store` |

- `:conversationId` is validated as a uuid before the service call (malformed → the same 404 as unknown).
- Error mapping through `AppError`: not found → 404 `NOT_FOUND`; `CHAT_ACCESS_EXPIRED` / `CHAT_CREATOR_BLOCKED` → 403; `IDEMPOTENCY_CONFLICT` → 409; own-account block stays 401 from the guard.
- Rate limit only if the existing helper fits (see Risks).
- Body size: JSON body limit is already global; a 2000-char message is far below it.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/chat/chat.controller.ts` | Two routes |
| CREATE | `apps/api/src/modules/chat/chat.module.ts` | Providers |
| CREATE | `apps/api/src/modules/chat/tokens.ts` | Injection token |
| MODIFY | `apps/api/src/app.module.ts` | Import `ChatModule` |
| CREATE | `apps/api/test/chat.int.spec.ts` | HTTP-level tests |

**Testing (HTTP, real DB + Redis per the existing int specs):**
- Roles: CREATOR token → 403 `FORBIDDEN_ROLE` on both routes; no token → 401; blocked customer → 401; `roles-declared.spec.ts` still passes.
- IDOR: other customer's conversation → 404 for GET and POST, identical body to an unknown id and to `not-a-uuid`; nothing stored.
- Validation: empty, whitespace, 2001 chars, missing / non-uuid `client_message_id`, extra `sender` key → 400; `limit=51`, `before=0` → 400.
- Send: 201 then the same request again → 200 with the same message id and one DB row; same id with other text → 409.
- Access: expired / revoked → 403 `CHAT_ACCESS_EXPIRED`; creator blocked → 403 `CHAT_CREATOR_BLOCKED`; no message and no outbox row in either case; GET still 200 with `access.state` `EXPIRED` / `CREATOR_BLOCKED`.
- Response never contains `mode`, `response_version`, user ids or creator ids (assert on keys); `Cache-Control: no-store`.
- Pagination: two pages cover all messages exactly once while a message is sent between the requests.

---

### TASK-151: Mini App chat data layer

`apps/miniapp/src/chat/` data code (no markup):

- `api-client.ts` additions to the existing `auth/api-client.ts`: `getChatHistory(conversationId, { before?, limit? })`, `sendChatMessage(conversationId, { client_message_id, body })`, parsed with the contract schemas; `ApiError.code` carries `CHAT_ACCESS_EXPIRED` / `CHAT_CREATOR_BLOCKED`.
- `useChat(conversationId)`:
  - loads the newest page; `loadOlder()` uses `next_before`, prepends, and is guarded against double calls; refetches the newest page on `visibilitychange` → visible and merges by `seq` / `id`;
  - `send(text)`: trims, ignores empty and over-limit input, creates `crypto.randomUUID()` as `client_message_id`, adds a local `sending` bubble, posts, then replaces it with the server message (match by `client_message_id`);
  - failure (network / 5xx / 409) → bubble `failed` keeping the same `client_message_id`; `retry(id)` reposts with that id; double taps while sending are ignored;
  - `CHAT_ACCESS_EXPIRED` / `CHAT_CREATOR_BLOCKED` → remove the unsent bubble, set the access state from the error (screen switches to the expired / blocked composer) and refetch the header;
  - `401` goes through the existing session-loss handling; `404` → a not-found state (placeholder).
- `chat-model.ts`: pure helpers: merge pages without duplicates, group by day in the account timezone, label (`Hari ini`, `Kemarin`, otherwise `Jumat, 6 Nov`; year added when not the current year, placeholder).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts` | Two calls |
| CREATE | `apps/miniapp/src/chat/useChat.ts` | State and actions |
| CREATE | `apps/miniapp/src/chat/chat-model.ts` | Merge, grouping, labels |
| CREATE | `apps/miniapp/src/chat/chat-model.spec.ts` | Unit tests |
| CREATE | `apps/miniapp/src/chat/useChat.spec.tsx` | Hook tests with a fake API |
| MODIFY | `apps/miniapp/test/fake-miniapp-api.ts` (or the existing fake) | Chat endpoints |

**Testing:**
- Merge: no duplicate when the refetched page overlaps; order stays by `seq`.
- Day labels around midnight in `Asia/Jakarta` vs another zone; "Kemarin" at the boundary.
- Send: success replaces the bubble; double tap posts once; network failure → `failed`, retry reuses the same `client_message_id` and ends with one bubble; `CHAT_ACCESS_EXPIRED` removes the bubble and flips state; empty / whitespace is not sent; 2001 chars is not sent.
- Older page prepends once; a second `loadOlder()` while loading is ignored.

---

### TASK-152: Mini App chat screen (`Chat`, `ChatExpired`, loading state)

Route `/chats/:conversationId` inside the USER shell (full-height screen without the bottom nav, as the boards show; the existing `/chats` placeholder is untouched). Build per screen: view the PNG, copy values from the HTML, re-implement as React components with CSS modules, no pasted HTML.

- Header: back arrow (to `/chats`), creator avatar, name, subtitle "Akses aktif hingga 27 Nov 2026" (`ends_at` in the account timezone), "…" button (no menu in this story: render it disabled/inert and report it, or omit if the board allows; do not invent a menu). While the first page loads, the subtitle reads "Memuat riwayat…" and the body shows the skeleton bubbles (`StatesAccess` frame).
- Body: day-separator chips, other-side bubbles left, my bubbles right with the time (`HH.mm`), my states **Mengirim…** (clock icon), **Belum terkirim** (alert icon, red) plus the **Kirim Ulang** link; scrolls to the bottom on open and after my own send; scrolling to the top loads older pages and keeps the scroll position. No AI/Manual label anywhere, no read ticks (US-030), no media bubbles (Phase D).
- Composer: "Tulis pesan" input + send button; send disabled for empty input; Enter sends; text over 2000 characters is blocked by the input's `maxLength` (no counter, not designed).
- `ChatExpired` (access state `EXPIRED`): subtitle "Akses telah berakhir", a pill "Akses berakhir 6 Nov 2026, 23.59 WIB" below the messages (from `ended_at` with the zone label), composer replaced by the panel "Akses telah berakhir / Riwayat chat tetap bisa kamu baca. Minta perpanjangan untuk melanjutkan percakapan." and the full-width button **Minta Perpanjangan Akses**, which calls the US-023 request (`/v1/creators/by-code/:publicCode/access-requests`) and then shows the existing pending/approved result the way the profile does (reuse its hook and copy; no new wording).
- `CREATOR_BLOCKED`: same panel position, placeholder copy in `chat-copy.ts` (e.g. "Creator sedang tidak tersedia." / "Riwayat chat tetap bisa kamu baca."), **no button**; recorded as a design gap.
- Copy: Indonesian, verbatim from the boards; buttons never wrap; status = icon + label.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/chat/ChatPage.tsx` | Screen and states |
| CREATE | `apps/miniapp/src/chat/chat.module.css` | Styles with exact values from `Chat.html` / `ChatExpired.html` |
| CREATE | `apps/miniapp/src/chat/chat-copy.ts` | All strings, placeholders marked |
| CREATE | `apps/miniapp/src/chat/ChatPage.spec.tsx` | Component tests |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | Add `/chats/:conversationId` to the USER shell |
| MODIFY | `apps/miniapp/src/preview/*` | Dev preview entries for the three states (to feed `pnpm visual`) |

**Testing:**
- Renders history with day separators and times in the account timezone; my bubbles show Mengirim… / Belum terkirim + Kirim Ulang; Kirim Ulang retries once; no text "AI" / "Manual" anywhere in the DOM (assert).
- Send flow: type, Enter, bubble appears immediately, then settles; empty input keeps the button disabled.
- Access flips: a 403 `CHAT_ACCESS_EXPIRED` on send shows the expired panel while the history stays; `CREATOR_BLOCKED` shows the placeholder panel without a button; "Minta Perpanjangan Akses" posts the US-023 request once.
- Loading frame shows skeleton and "Memuat riwayat…"; a CREATOR session on `/chats/…` is redirected by the role gate; a 404 shows the placeholder not-found state.

---

### TASK-153: Seed fixtures, visual check and docs

- Seed (packages/db/seed): make sure Raka ↔ Salsa (active) and Raka ↔ Kirana (expired) have conversations; add the design's text messages for both (Salsa side: a few days of text with "Kemarin" and "Hari ini" relative to seed time; Kirana: the 6 Nov messages), without media messages. Seed stays idempotent.
- `pnpm visual`: compare 390×844 screenshots with `Chat.png` (text bubbles only; the media bubbles and the "Dibaca" tick are expected differences, documented), `ChatExpired.png`, and the `StatesAccess` loading frame. Record the accepted differences in the QA notes.
- Update `.agile/guidelines/codebase-map.md` (entities: `Message`, `Conversation.last_message_seq`; endpoints; Mini App route; outbox type `message.created`), `design-integration.md` Known Gaps (creator-blocked chat state, send-failure wording, other-year day label, "…" menu, empty conversation), and `tech-stack.md` decisions log (2000-char limit, seq keyset pagination, retry-after-expiry returns the stored message). README/CONFIGURATION need no change (no new env var).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/seed/*` | Messages for the two fixtures |
| MODIFY | `apps/miniapp/visual/*` (existing harness config) | Three new comparisons |
| MODIFY | `.agile/guidelines/codebase-map.md` | Keep in sync |
| MODIFY | `.agile/guidelines/design-integration.md` | New gaps |
| MODIFY | `.agile/guidelines/tech-stack.md` | Decisions log |

**Testing:**
- Seed twice → no duplicate messages; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; integration suites green against `DATABASE_URL_TEST`; `pnpm visual` passes for the three frames.

---
