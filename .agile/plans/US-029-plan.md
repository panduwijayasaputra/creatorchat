# Technical Plan: US-029 — Creator conversation, manual reply and customer detail

## Architecture Overview

Vertical slice: contract → migration (`messages.origin`) → `CreatorChatService` (backend-core) → creator chat endpoints → Mini App `/inbox/:conversationId` (`CrChatManual`, `CrChatExpired`) and `/inbox/:conversationId/customer` (`CrCustomer`). Mirrors US-026 from the creator's side: same HTTP + `client_message_id` + outbox rules, same Kirim Ulang behaviour, same row-lock transaction.

Brief refs: §6 (no new activity to a customer without active access), §7 (manual send; creator-side source metadata allowed), §10, §14. Design refs: `CrChatManual`, `CrChatExpired`, `CrCustomer` (390×844 each).

Decisions agreed with the user (2026-11-17):

| Topic | Decision |
|---|---|
| Origin | `messages.origin` enum `MANUAL \| AI`, NOT NULL DEFAULT `MANUAL`, added now. Creator sends write `MANUAL` explicitly. Exposed to the **creator** API only (for the pencil "Manual" tag on my own bubbles). The customer API never returns it. |
| Phase F parts | Omitted: the Manual / Aktifkan AI panel, "Kamu mengambil alih…" and "AI dijeda…" notes, the composer hint that points at the AI panel, the attach button (Phase D), the AI card and the "AI tidak menyimpan memori…" footnote on `CrCustomer`. The "Manual" tag on my own bubbles stays. |
| Reuse | Separate creator endpoints and service. On the Mini App `useChat` takes the two API functions, and the bubble / day-group / composer pieces are extracted from `ChatPage` into a shared file used by both screens. The US-026 tests stay green unchanged. |

Defaults applied (flag if you disagree):

- **Access for the creator:** two states, `ACTIVE` and `EXPIRED`. EXPIRED covers expired, revoked, no subscription and customer blocked / not a USER (the same rule as the inbox chip). The customer detail and header show the date when there is one.
- **No composer when not active:** replaced by the board panel "Akses pelanggan telah berakhir. / Masa akses dikelola admin."; the server refuses too.
- **Ended-access pill** under the last message ("Akses pelanggan berakhir 6 Nov 2026, 23.59 WIB") uses `ended_at` in my zone; with no date, the pill is omitted.
- **Info button** (i) in the header opens `/inbox/:conversationId/customer`; "Buka Chat" there goes back to `/inbox/:conversationId`.
- The creator's own read cursor is **not** written here (US-030).

## Authorization & Data Rules

- Routes (all `@UseGuards(UserJwtGuard, RolesGuard)`, `@Roles('CREATOR')`, `Cache-Control: no-store`):
  - `GET /v1/creator/conversations/:conversationId/messages?before&limit`
  - `POST /v1/creator/conversations/:conversationId/messages`
  - `GET /v1/creator/conversations/:conversationId/customer`
- USER token → 403 `FORBIDDEN_ROLE`; blocked creator account → 401 (existing guards); `roles-declared.spec.ts` stays green.
- Scope from the session only: creator row by `creators.user_id = session user`; every statement carries `conversations.creator_id = that creator`. Another creator's id, an unknown id and a malformed id all give the same 404. No creator row → 404.
- Send: one transaction; lock the conversation row (`FOR UPDATE OF c`); replay a repeated `client_message_id` for the same sender (same text → stored message 200; other text → 409 `IDEMPOTENCY_CONFLICT`); then require entitlement (customer `ACTIVE` + role `USER`, subscription via `isEntitled`) else 403 `CHAT_ACCESS_EXPIRED`, nothing stored; then `UPDATE conversations SET last_message_seq = last_message_seq + 1, last_message_at = now, updated_at = now` (the US-028 rule), insert the message (`origin = 'MANUAL'`), add outbox `message.created` (ids only, `sender_id` = creator user) in the same transaction. Body trimmed, 1–2000 code points (`CHAT_TEXT_MAX`).
- Unique key (conversation, sender, client_message_id) already makes the retry DB-enforced; the creator and the customer use different senders, so ids cannot collide across them.
- Privacy of answers: customer `display_name`, https `avatar_url`; the detail answer adds `username` (Telegram `@name` or `null`). **Never** the Telegram numeric id, user ids, subscription row ids, other creators' data, `mode` / `response_version`.
- Socket events: none (US-031). The outbox event has no handler yet.

## Dependencies

- No new packages, no env vars. Reuses `ChatService` patterns, `isEntitled`, `OutboxService`, `ZodValidationPipe`, `AppError`, `CurrentUser`, `formatTime` / `formatDateTime` / `zoneLabel`, `BottomToast`, `Avatar`, the inbox initials/tone helpers.
- Prior stories present: US-026 (`messages`, `ChatService`, `useChat`, `ChatPage`), US-028 (inbox, `last_message_at`, row links), US-009 (display timezone), US-006 (roles).
- Migration: new folder after `20261127010000`.

## Risks

- **Refactor of the US-026 UI:** extracting shared pieces could break the customer chat. Mitigation: move code without changing behaviour; the existing `ChatPage` / `useChat` specs and the visual items `miniapp-chat*` must pass untouched.
- **`last_message_at` forgotten on the creator send** would hide a new reply from ordering in the inbox. Mitigation: explicit test (send moves the conversation to the top of the creator inbox).
- **Seed parity:** `CrChatManual` lists "Rani Anggraini" with 27 Nov; the seed has its own people (Raka, Salsa…). The visual items use mocked answers like earlier boards; the seed only needs to give the local creator a conversation with a customer message.
- **Placeholder copy (reported as gaps in one `creator-chat-copy.ts`):** the failed-send state wording reuses the customer copy; the `CrCustomer` variant for an ended access (board shows only active); customer without a Telegram username ("dari Telegram" alone); "not found" and error screens reuse the customer chat ones.

## Tasks

### TASK-167: Creator chat contracts

`packages/contracts/src/creator-chat.ts` (re-export from `index.ts`):

- Paths: `CREATOR_CONVERSATIONS_PATH = '/v1/creator/conversations'` (messages at `/:id/messages`, detail at `/:id/customer`).
- `CreatorChatHistoryQuerySchema` (strict): `before?` int ≥ 1, `limit` 1..50 default 30 (same rules as `ChatHistoryQuerySchema`; reuse it if identical).
- `CreatorChatMessageSchema`: `{ id: uuid, client_message_id: uuid, seq: int ≥ 1, sender: 'ME' | 'CUSTOMER', type: 'TEXT', body, origin: 'MANUAL' | 'AI', created_at: iso }`.
- `CreatorChatAccessSchema`: `{ state: 'ACTIVE' | 'EXPIRED', ends_at: iso | null, ended_at: iso | null }` (`ends_at` only when ACTIVE; `ended_at` only when EXPIRED and known).
- `CreatorChatHistoryResponseSchema`: `{ conversation: { id: uuid, customer: { display_name, avatar_url: https | null }, access }, items: Message[] (newest first), next_before: int | null }`.
- `CreatorSendMessageBodySchema` / `…ResponseSchema`: reuse the US-026 shapes (`client_message_id`, `body`) and answer with `{ message: CreatorChatMessage }`.
- `CreatorCustomerDetailResponseSchema`: `{ customer: { display_name, avatar_url, username: string | null }, access }`.
- All strict; no key named `telegram_id`, `user_id`, `customer_id`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-chat.ts` | Schemas and paths |
| CREATE | `packages/contracts/src/creator-chat.spec.ts` | Schema tests |
| MODIFY | `packages/contracts/src/index.ts` | Export |

**Testing:**
- Query defaults, `limit` 0 / 51, `before` 0, unknown key → fail.
- Message with `sender: 'CREATOR'` or an unknown `origin` fails; a sample with `telegram_id` / `customer_id` added fails (strict).
- Access shape: ACTIVE needs `ends_at`; both null allowed for EXPIRED.

---

### TASK-168: `messages.origin` migration and seed check

- `enum MessageOrigin { MANUAL AI }`; `Message.origin MessageOrigin @default(MANUAL)` → column `origin`, NOT NULL DEFAULT `'MANUAL'`.
- Migration folder `20261128010000_message_origin`: `CREATE TYPE "MessageOrigin"`, `ALTER TABLE messages ADD COLUMN origin … NOT NULL DEFAULT 'MANUAL'` (existing rows become MANUAL).
- `ChatService.send` (customer, US-026) writes nothing new (default applies) but the customer answer mapping stays free of `origin`; add an assertion.
- Seed: confirm the existing chat fixtures load unchanged (no seed edit expected).
- Dev DB: `prisma migrate deploy`; never reset. Test DB through `prepareTestDatabase`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | Enum and column |
| CREATE | `packages/db/prisma/migrations/20261128010000_message_origin/migration.sql` | Enum, column |
| CREATE | `packages/db/test/message-origin.int.spec.ts` | Default and enum tests |
| MODIFY | `packages/backend-core/src/chat/chat.service.int.spec.ts` | Customer send stores MANUAL |

**Testing:**
- Insert without `origin` → `MANUAL`; an invalid value refused; seeded messages are all `MANUAL`.

---

### TASK-169: `CreatorChatService` in backend-core

`packages/backend-core/src/creator-chat/creator-chat.service.ts` (+ `index.ts`, exported from the package index). Constructor `(prisma, outbox, clock = () => new Date())`.

```ts
history(creatorUserId, conversationId, q: { before?: number; limit: number })
  → { kind: 'ok'; history } | { kind: 'not_found' }
send(creatorUserId, conversationId, input: { clientMessageId; body })
  → { kind: 'created' | 'replayed'; message } | { kind: 'not_found' | 'access_expired' | 'conflict' | 'invalid' }
customerDetail(creatorUserId, conversationId)
  → { kind: 'ok'; customer: { displayName, avatarUrl, username | null }; access } | { kind: 'not_found' }
```

- `loadConversation(db, creatorUserId, conversationId, lock)`: raw SQL joining `conversations c`, `creators cr` (`cr.user_id = me`, `c.creator_id = cr.id`), customer `users cu`; returns customer name, avatar, `telegram_username`, `customer_ok`, `customer_id`.
- Access: subscription `findUnique(customerId_creatorId)`, `isEntitled` and `customer_ok` → ACTIVE (`endsAt`), else EXPIRED with `endedAt` as in `chatAccessState`.
- Send as in "Authorization & Data Rules". The transaction body should reuse the structure of `ChatService.send`; share the small pure pieces (code-point check, `https`) rather than copying them where it is a one-line import.
- `sender`: `ME` when `sender_user_id = creatorUserId`, else `CUSTOMER`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-chat/creator-chat.service.ts` | Service |
| CREATE | `packages/backend-core/src/creator-chat/index.ts` | Barrel |
| MODIFY | `packages/backend-core/src/index.ts` | Export |
| CREATE | `packages/backend-core/src/creator-chat/creator-chat.service.int.spec.ts` | Integration tests |

**Testing (real PostgreSQL):**
- History: newest first by `seq`, keyset `before`, `next_before` null on the last page; senders mapped ME / CUSTOMER; readable after expiry.
- Send: creates (`origin = MANUAL`, `seq` gap-free, `last_message_at` set, outbox row with ids only and no body); the conversation moves to the top of `CreatorInboxService.list`.
- Retry: same id + same text → replayed, one row; same id + other text → `conflict`; 20 concurrent sends with the same id → one row; concurrent distinct sends → distinct gap-free seq.
- Access: expired, revoked, no subscription, customer blocked, customer promoted to CREATOR → `access_expired`, nothing stored, no outbox row, `last_message_seq` unchanged.
- IDOR: creator B on creator A's conversation → `not_found` for history, send and detail; a USER id as `creatorUserId` → `not_found`; unknown id.
- Detail: username present / null; output keys carry no Telegram id or user id.
- Blank and 2001-code-point bodies → `invalid`.

---

### TASK-170: API endpoints

New `CreatorChatController` (`@Controller('creator/conversations')`, `UserJwtGuard` + `RolesGuard`, `@Roles('CREATOR')` on every route, `no-store`) in the creator module; provider token `CREATOR_CHAT` in `tokens.ts`; module factory builds `CreatorChatService(prisma.client, outbox)`.

- `GET :conversationId/messages` (query pipe), `POST :conversationId/messages` (body pipe; 201 new / 200 replay), `GET :conversationId/customer`.
- Malformed uuid → the same 404 as unknown. `access_expired` → 403 `CHAT_ACCESS_EXPIRED`; `conflict` → 409 `IDEMPOTENCY_CONFLICT`; `invalid` → 400 `VALIDATION_FAILED`.
- Maps rows to snake_case with ISO dates, and `ends_at` / `ended_at` as in the contract.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creator/creator-chat.controller.ts` | Routes |
| MODIFY | `apps/api/src/modules/creator/creator.module.ts`, `tokens.ts` | Provider, controller |
| CREATE | `apps/api/test/creator-chat.int.spec.ts` | HTTP tests |

**Testing (real app):**
- No token 401; USER 403 `FORBIDDEN_ROLE`; blocked creator account 401; another creator's id 404 (history, send, customer) with a body identical to an unknown id.
- Send 201 then repeat 200 with one row; other text 409; expired access 403 with nothing stored; strict body (unknown key, blank) 400.
- Raw JSON assertions: no `telegram_id`, user id, `mode`; the customer-side `GET /v1/chats/:id/messages` still has no `origin` after a creator reply.
- `no-store`; `roles-declared.spec.ts` passes.

---

### TASK-171: Mini App data layer and shared chat pieces

- `auth/api-client.ts`: `getCreatorChatHistory(conversationId, { before?, limit })`, `sendCreatorChatMessage(conversationId, { client_message_id, body })`, `getCreatorCustomer(conversationId)`; parsed with the contract schemas; added to `MiniappApi` and the fake API (`creatorChatResults/Calls`, `creatorCustomerResults/Calls`).
- `chat/useChat.ts`: accepts an adapter `{ getHistory, send }` instead of `Pick<MiniappApi, …>`; customer wrapper keeps the old call shape. The state's message type becomes a minimal common shape (`id`, `client_message_id`, `seq`, `body`, `created_at`, `mine: boolean`, `origin?`) so one hook serves both; the customer mapping sets `mine = sender === 'ME'`. Behaviour (supersede, dedupe, Kirim Ulang with the same id, visible-refetch) unchanged.
- Extract `Bubble`, day separators and the composer from `ChatPage.tsx` into `chat/ChatThread.tsx` (props: messages, unsent, timezone, `showManualTag`, composer slot); styles stay in `chat.module.css` (no visual change for the customer).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts` | Three methods |
| MODIFY | `apps/miniapp/test/fake-miniapp-api.ts` | Fakes and helpers |
| MODIFY | `apps/miniapp/src/chat/useChat.ts`, `chat-model.ts` | Adapter, common message shape |
| CREATE | `apps/miniapp/src/chat/ChatThread.tsx` | Shared bubble / day / composer |
| MODIFY | `apps/miniapp/src/chat/ChatPage.tsx` | Use the shared pieces |
| MODIFY | `apps/miniapp/src/chat/useChat.spec.tsx`, `ChatPage.spec.tsx` | Only if types force it; no behaviour edits |

**Testing:**
- All US-026 specs pass unchanged in behaviour.
- Creator adapter: first page, older page, send success / failure / Kirim Ulang with the same id, 403 `CHAT_ACCESS_EXPIRED` on send shows failed and the access flips to EXPIRED on the next refresh.

---

### TASK-172: Mini App screens `CrChatManual`, `CrChatExpired`, `CrCustomer`

Per screen: PNG first, exact values from the HTML, CSS modules, no pasted HTML. Routes in `routes.tsx` (CREATOR role, full screen, no bottom nav): `inbox/:conversationId` → `CreatorChatPage`, `inbox/:conversationId/customer` → `CreatorCustomerPage` (replacing the US-029 placeholder).

- `CreatorChatPage` (`CrChatManual`): header (back to `/inbox`, avatar 40 with initials and the inbox tone, name, "Akses aktif hingga 27 Nov 2026" / "Akses telah berakhir", (i) → customer page), day separators, customer bubbles left, mine right with time and the pencil "Manual" tag (when `origin = MANUAL`), composer "Tulis balasan" with the send button (disabled when blank), no attach button, no hint line, no AI panel. Mengirim… / Belum terkirim / Kirim Ulang as in the customer chat.
- Expired (`CrChatExpired`): grey strip "Akses berakhir" + "AI tidak membalas dan broadcast baru tidak diterima." (clock icon + label), history, the ended pill, composer replaced by the "Akses pelanggan telah berakhir. / Masa akses dikelola admin." panel. If access flips during the session (send refused with 403), the screen switches to this state.
- `CreatorCustomerPage` (`CrCustomer`): title "Detail pelanggan" + back, avatar 64 initials, name, "@username · dari Telegram" (no username: "dari Telegram"), access card (check icon, "Akses aktif hingga 27 Nov 2026", "Berakhir pukul 23.59 WIB · dikelola admin" from `ends_at` in my zone), **Buka Chat** → `/inbox/:conversationId`. No AI card, no footnote. Ended variant: placeholder (clock icon, "Akses telah berakhir", "Berakhir {date} · dikelola admin").
- Loading, not-found (identical for unknown ids) and error reuse the customer chat screens; texts in `creator-chat-copy.ts` with placeholders marked.
- Inbox row links already point here (US-028).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/creator-chat/CreatorChatPage.tsx` | Conversation screen and expired state |
| CREATE | `apps/miniapp/src/creator-chat/CreatorCustomerPage.tsx` | Customer detail |
| CREATE | `apps/miniapp/src/creator-chat/creator-chat.module.css` | Exact board values |
| CREATE | `apps/miniapp/src/creator-chat/creator-chat-copy.ts` | Strings; placeholders marked |
| CREATE | `apps/miniapp/src/creator-chat/CreatorChatPage.spec.tsx`, `CreatorCustomerPage.spec.tsx` | Component tests |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | Two routes (re-read the file first: another session edits it) |

**Testing:**
- Active: header subtitle, bubbles with times in the account zone, the Manual tag on mine only, no AI text, no Telegram id / user id in the DOM; send posts once, shows Mengirim… then settles; failure shows Belum terkirim + Kirim Ulang reusing the same id.
- Expired: strip, pill, composer replaced, no input in the DOM; a 403 on send moves a live screen into the expired layout.
- Customer page: username line with and without username, access card times in two zones, Buka Chat link, no AI card.
- A USER session is redirected by the role gate; unknown id shows the not-found screen.

---

### TASK-173: Visual check and docs

- Playwright (`visual/specs/visual.spec.ts`): `miniapp-cr-chat-manual`, `miniapp-cr-chat-expired`, `miniapp-cr-customer` at 390×844 against the boards (creator session, mocked answers: Rani with 27 Nov, Nadia ended 6 Nov). Expected differences: the AI panel, notes, hint, attach button and the AI card / footnote.
- Update `codebase-map.md` (message `origin`, three endpoints, two routes, design inventory, feature backlog), `design-integration.md` Known Gaps (ended-access `CrCustomer`, no-username line, Phase F parts omitted), `tech-stack.md` decisions log (origin enum, creator access states).
- Seed check: log in as the seed creator, open Salsa's conversation from the inbox, send a reply, see it at the top of the inbox.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/specs/visual.spec.ts` | Three comparisons |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `tech-stack.md` | Keep in sync |

**Testing:**
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; `pnpm visual -g cr-` passes with the differences documented in the QA report.

---
