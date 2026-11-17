# Technical Plan: US-030 — Read receipts and unread counts

## Architecture Overview

Vertical slice over tables that already exist: `conversation_reads` (US-028) and `messages` (US-026). No schema change. Contract → `ConversationReadService` (backend-core) → two `POST …/read` routes plus a creator unread-count route → Mini App (customer chat marks as read and shows "Dibaca"; `UnreadProvider` also feeds the creator's Inbox badge). The unread counts of `Chats` (US-027) and `CrInbox` (US-028) already read the cursor, so they clear as soon as something moves it.

Brief refs: §7 (unread), §13 (ConversationRead: participant/conversation UNIQUE, read cursor), §14 (`read.updated`). Design refs: `Chat` ("Dibaca"), `ChatExpired`, `Chats`, `CrInbox` (unread badges, "Belum Dibaca n", nav badge "2 percakapan belum dibaca").

Decisions agreed with the user (2026-11-17):

| Topic | Decision |
|---|---|
| Creator half | Build the creator read endpoint, its tests and the Inbox tab badge **now**; the creator conversation screen (US-029) only has to call the endpoint when it opens. |
| "Dibaca" rule | One rule in both access states: double tick + "Dibaca" under **my latest message that the creator has read**. The `ChatExpired` board shows the tick without the word; that stays a logged difference. |

Defaults applied (flag if you disagree):

- **Reads are an explicit `POST`**; `GET` history stays free of side effects.
- **The cursor moves only while the page is visible** (`document.visibilityState === 'visible'`), and only when a message from the other side is above it.
- **The creator never sees the customer's cursor** (`CrChatManual` has no marker). Only the customer's history carries `peer_read_seq`.
- **`through_seq` above the conversation's newest message is clamped**, not rejected: a client that raced a send must not get an error for reading what exists.
- **A `read.updated` outbox event is written when the cursor actually moves** (ids and the new seq only), so US-031 can publish it after commit. A no-op request writes nothing.
- **Badges:** the customer badge (`GET /v1/chats/unread`, US-027) is unchanged; the creator badge counts **conversations** with unread messages (the board label says "percakapan").

## Authorization & Data Rules

- Routes: `POST /v1/chats/:conversationId/read` (`@Roles('USER')`) and `POST /v1/creator/inbox/:conversationId/read` (`@Roles('CREATOR')`), `GET /v1/creator/inbox/unread` (`@Roles('CREATOR')`). All under `UserJwtGuard` + `RolesGuard`; `roles-declared.spec.ts` stays green. A USER on a creator route and a CREATOR on a customer route → 403 `FORBIDDEN_ROLE`; a blocked account → 401.
- Scope: the caller must be the **customer** (USER route) or the **creator's user** (CREATOR route) of the conversation, enforced inside the one SQL lookup (`conversations c JOIN creators cr … WHERE c.id = $1 AND (c.customer_id = $me | cr.user_id = $me)`). Another conversation, unknown id or malformed id → the same 404 `NOT_FOUND`. The caller can only ever move **their own** cursor: the row key is `(conversation_id, session user id)`, never a user id from the request.
- No entitlement check: reading is allowed after expiry and for a blocked creator's chat (history stays readable, brief §6). A blocked caller is stopped by the guards.
- Monotonic cursor: `SELECT … FROM conversations … FOR UPDATE`, then `INSERT INTO conversation_reads … ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_seq = GREATEST(conversation_reads.last_read_seq, EXCLUDED.last_read_seq), updated_at = now() WHERE conversation_reads.last_read_seq < EXCLUDED.last_read_seq RETURNING …`. An older request never lowers it; `through_seq` is clamped to `conversations.last_message_seq` first; `through_seq` ≥ 0 (a body of 0 is a no-op).
- `moved` is true only when the row was inserted above 0 or updated upward; only then is the outbox row written, in the same transaction: type `read.updated`, aggregate `conversation`, payload `{conversation_id, reader_id, last_read_seq}` (ids and a number), dedupe key `read:<conversationId>:<readerId>:<seq>` (so a retry of the same advance writes nothing).
- Privacy: the customer's history gets `peer_read_seq` = the **creator's** `last_read_seq` (0 when no row). The creator's inbox, list and history never expose the customer's cursor. No ids in any answer.
- `GET /v1/creator/inbox/unread`: `{ unread_conversations }`, scoped by the session user's creator row, the same count the inbox uses (shared SQL helper in `CreatorInboxService`). `no-store`, read-only.

## Dependencies

- No new packages, no env vars, no migration. Reuses `OutboxService`, `ZodValidationPipe`, `AppError`, `CurrentUser`, `UnreadProvider` (US-027), `Chat` page (US-026), `CreatorInboxService` (US-028).
- Prior stories present: US-026, US-027, US-028. US-029 (creator conversation screen) is **not** built; its integration is the single call to the creator read endpoint (recorded in its story as a note).

## Risks

- **Out-of-order requests** (a slow older `POST` after a newer one): `GREATEST` plus the conditional update; tested with parallel calls.
- **Chatty client:** a read on every message could flood. Mitigation: the client keeps the highest seq it has acknowledged and posts only when the newest other-side seq is higher; at most one request in flight (a pending newer value is sent when it returns).
- **No realtime until US-031:** the creator's "Dibaca" marker on the customer side updates on the next open or refetch, and badges on the next navigation, as for the other counts. `read.updated` is written now so US-031 only publishes it.
- **Marker vs. board:** `ChatExpired` shows the tick without the word; logged as a difference in QA.
- **Parallel work on `ChatPage`:** US-029's plan extracts `Bubble`, day separators and the composer into `chat/ChatThread.tsx`. If US-029 lands first, TASK-177 puts the "Dibaca" marker in `ChatThread` (customer only, behind a prop) instead of `ChatPage`; re-read both files before editing. Task IDs of this story were moved to 174–178 because US-029 uses 167–173.
- **A creator who never opens a chat** (US-029 missing) keeps the badge; expected until US-029.

## Tasks

### TASK-174: Read contracts

`packages/contracts/src/chat-read.ts` (re-export from `index.ts`):

- `ReadBodySchema` (strict): `{ through_seq: int ≥ 0 }`; unknown keys (`user_id`, `conversation_id`) → 400.
- `ReadResponseSchema` (strict): `{ last_read_seq: int ≥ 0 }` (the cursor after the call, clamped and monotonic).
- `CreatorUnreadResponseSchema` (strict): `{ unread_conversations: int ≥ 0 }`; `CREATOR_UNREAD_PATH = '/v1/creator/inbox/unread'`; path helpers `chatReadPath(id)` and `creatorReadPath(id)`.
- Extend the customer chat history response (US-026 `ChatHistoryResponseSchema`): `conversation.peer_read_seq: int ≥ 0`.
- New outbox type string `read.updated` is added in backend-core (TASK-175), not here.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/chat-read.ts`, `chat-read.spec.ts` | Schemas, paths |
| MODIFY | `packages/contracts/src/chat.ts` | `peer_read_seq` in the history |
| MODIFY | `packages/contracts/src/index.ts` | Export |

**Testing:**
- Body: 0 and a large int pass; negative, float, string, missing, extra key fail.
- History schema requires `peer_read_seq`; the creator unread schema is strict.

---

### TASK-175: `ConversationReadService` in backend-core

`packages/backend-core/src/chat/conversation-read.service.ts` (exported from the chat barrel). Constructor `(prisma, outbox: OutboxService, clock = () => new Date())`.

```ts
advance(userId: string, as: 'customer' | 'creator', conversationId: string, throughSeq: number):
  Promise<{ kind: 'ok'; lastReadSeq: number; moved: boolean } | { kind: 'not_found' }>
```

- One transaction: the scoped, `FOR UPDATE` conversation lookup (customer: `c.customer_id = userId`; creator: `cr.user_id = userId`); clamp `throughSeq` to `last_message_seq`; the guarded upsert from the rules above; if moved, `OutboxService.add` with `read.updated`.
- `OutboxEventType.READ_UPDATED = 'read.updated'` added (comment: no handler until US-031).
- Customer history (`ChatService.history`) also selects the creator's cursor and returns it as `peerReadSeq` (0 without a row); a creator-side reader never gets it.
- `CreatorInboxService.unreadConversations(creatorUserId): Promise<number>`: the existing total-count statement extracted and reused by `list` and the new route.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/chat/conversation-read.service.ts` | Advance |
| CREATE | `packages/backend-core/src/chat/conversation-read.service.int.spec.ts` | Integration tests |
| MODIFY | `packages/backend-core/src/chat/chat.service.ts`, `index.ts` | `peerReadSeq`, barrel |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | Event type |
| MODIFY | `packages/backend-core/src/creator-inbox/creator-inbox.service.ts` | `unreadConversations` |

**Testing (real PostgreSQL):**
- Customer and creator advance their own cursors independently; the other participant's row is untouched.
- Interleaved sends and reads over two participants: unread (via `ChatListService.unreadTotal` and `CreatorInboxService`) is correct after each step; reading everything gives 0.
- Monotonic: advancing to 5 then 3 leaves 5 and reports `moved=false`; 10 parallel advances with different values end at the maximum; a repeat of the same value is `moved=false` with no second outbox row.
- Clamp: `through_seq` above `last_message_seq` stores the last seq; 0 on an empty chat stores nothing and writes no event.
- Outbox: one `read.updated` per real move, payload ids and a number only, deduped on a retry of the same advance.
- IDOR: another customer, another creator, a creator id on the customer path and vice versa, an unknown uuid → `not_found`, nothing stored.
- Allowed after expiry and with a blocked creator.
- `history` returns `peerReadSeq` for the customer path and it follows the creator's cursor.

---

### TASK-176: API endpoints

- `POST /v1/chats/:conversationId/read` on `ChatController` (`@Roles('USER')`, 200 `{last_read_seq}`, `no-store`).
- `POST /v1/creator/inbox/:conversationId/read` and `GET /v1/creator/inbox/unread` on `CreatorInboxController` (`@Roles('CREATOR')`). `GET inbox/unread` is a separate route from `GET inbox` (no clash with the `:conversationId` POST).
- `ZodValidationPipe(ReadBodySchema)`; non-uuid `:conversationId` → the same 404; `not_found` → 404 `NOT_FOUND`.
- The customer history route maps `peer_read_seq` into the response.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/chat/chat.controller.ts` | Read route, `peer_read_seq` |
| MODIFY | `apps/api/src/modules/chat/chat.module.ts`, `tokens.ts` | Provider |
| MODIFY | `apps/api/src/modules/creator/creator-inbox.controller.ts`, `creator.module.ts`, `tokens.ts` | Read + unread routes |
| CREATE | `apps/api/test/chat-read.int.spec.ts` | HTTP tests |

**Testing (real app):**
- No token 401; a CREATOR token on the customer route and a USER token on the creator routes → 403 `FORBIDDEN_ROLE`; blocked account 401.
- IDOR: another customer's / another creator's conversation, unknown and non-uuid ids → the same 404 body, nothing stored.
- 400 for negative, float, missing, extra key.
- The cursor only moves forward over HTTP (5 then 3 → still 5); the response is the clamped cursor.
- After the customer reads, `GET /v1/chats/unread` and the chat list drop; after the creator reads, `GET /v1/creator/inbox`, `…/inbox/unread` and the `unread_conversations` chip drop.
- The customer history shows `peer_read_seq` that follows the creator's read; the creator inbox answer holds no customer cursor.
- Reading works for an expired conversation; `no-store`.

---

### TASK-177: Mini App: mark as read, "Dibaca", creator badge

- `api-client.ts` + fake API: `markChatRead(conversationId, throughSeq)`, `getCreatorUnread()`; the History type gains `peer_read_seq`.
- `useChat`: after the first page and after every merge that raises the newest **creator** message seq, post `markChatRead` when the page is visible; keep the highest acknowledged seq, one request in flight, a newer pending value sent when it returns; failures are silent (retried by the next trigger). The visible-again refetch (US-026) triggers the same check. Exposes `peerReadSeq` from the history/refresh (monotonic: never lowered).
- `ChatPage`: under my **latest message with `seq ≤ peer_read_seq`**, the meta line shows the double tick (`CheckIcon`-based or an icon from `packages/ui`, stroke `--rose`) and "Dibaca" as in `Chat.html` (`09.05 ✓✓ Dibaca`); no marker on other bubbles and none while Mengirim… / Belum terkirim; same component in `ChatExpired`. Customer only: creator screens never get it.
- `UnreadProvider` (US-027): for a CREATOR fetch `getCreatorUnread()` (same mount / route-change throttle / visibility rules) and feed the creator shell's Inbox badge; customers keep `getChatUnread`. Badge label for the creator: "n percakapan belum dibaca" per the board; hidden at 0.
- `CreatorShell` takes the count from the same provider.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts`, `test/fake-miniapp-api.ts` | New calls |
| MODIFY | `apps/miniapp/src/chat/useChat.ts`, `useChat.spec.tsx` | Mark read, `peerReadSeq` |
| MODIFY | `apps/miniapp/src/chat/ChatPage.tsx`, `chat.module.css`, `chat-copy.ts`, `ChatPage.spec.tsx` | "Dibaca" marker |
| MODIFY | `apps/miniapp/src/chats/UnreadProvider.tsx` (+ spec), `components/shell/Shells.tsx`, `app/routes.tsx` | Creator badge |

**Testing:**
- Hook: opening posts the newest creator seq once; no post when nothing is newer; a hidden tab posts nothing and a later visible event does; two quick merges post one request at a time with the latest value; a failed post is retried on the next trigger; `peerReadSeq` never decreases.
- Page: "Dibaca" appears only under the latest read own message, not under unsent ones, not when `peer_read_seq` is 0; the same in the expired state; no "Dibaca" text for the creator pages (assert on the creator inbox DOM).
- Provider: a CREATOR fetches `getCreatorUnread` and shows the badge; a USER still fetches `getChatUnread`; neither fetches when signed out; a failure keeps the last value.

---

### TASK-178: Visual check and docs

- Playwright: update `miniapp-chat` (the `Dibaca` marker on "Pengin coba bikin roti sobek." now matches the board's `09.05 ✓✓ Dibaca`), `miniapp-chat-expired` (tick + word, logged difference), and the creator inbox frames now showing the nav badge `2` (`miniapp-inbox`); review the sheets side by side.
- Docs: `codebase-map.md` (endpoints, outbox type, route notes, feature status), `design-integration.md` (Dibaca difference on `ChatExpired`; creator nav badge wording), `tech-stack.md` decisions log (explicit POST, monotonic clamp, `read.updated` written now), and a note in `US-029` that its screen must call the creator read endpoint.
- Seed check: with the seeded cursors (Salsa 2 unread for Raka), opening the chat clears the customer badge locally.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/specs/visual.spec.ts` | Updated comparisons |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `tech-stack.md` | Keep in sync |
| MODIFY | `.agile/features/manual-chat/US-029-creator-conversation-manual-reply.md` | Note: call the read endpoint |

**Testing:**
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; `pnpm visual -g "miniapp-(chat|inbox)"` passes with documented differences.

---
