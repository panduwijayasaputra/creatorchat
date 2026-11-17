# Technical Plan: US-031 — Realtime updates and reconnect

## Architecture Overview

Vertical slice: contract (events) → migration (`outbox_events.realtime_published_at`) → `RealtimePublisher` (backend-core) → worker loop that emits through Redis → Socket.IO gateway in the API (auth, `user:<id>` rooms, forced disconnects) → Mini App socket client and live views (open chat, chat list, inbox, nav badges, inbox offline panel).

```
HTTP write (US-026 / 029 / 030) ── tx ──▶ messages / conversation_reads + outbox_events (PENDING)
                                                   │ (commit)
worker: RealtimePublisher loop (1 s) ── claims rows with realtime_published_at IS NULL
        resolves the two participants from the DB ── @socket.io/redis-emitter ──▶ Redis
API:    socket.io Server + @socket.io/redis-adapter ──▶ sockets in room user:<id>
Mini App: event = signal only ─▶ refetch over HTTP (existing refresh() / list / inbox / unread calls)
```

Brief refs: §3 (stale sessions lose privilege), §7 (history not lost on disconnect; reconnect fetches over HTTP), §14 (committed events `message.created`, `conversation.updated`, `read.updated`; server-derived rooms; outbox + reconciler). Design refs: `CrStatesInbox` (offline panel, already built from browser events in US-028), `Chat`, `Chats`, `CrInbox`.

Decisions agreed with the user (2026-11-17):

| Topic | Decision |
|---|---|
| Event payload | **Signal only.** `message.created {conversation_id, seq}`, `read.updated {conversation_id, through_seq}`, `conversation.updated {conversation_id}`. No message text, names or previews cross the socket or Redis; the client refetches over HTTP (its existing merge logic). |
| Delivery marker | New `outbox_events.realtime_published_at timestamptz NULL`. A worker `RealtimePublisher` loop claims unpublished `message.created` / `read.updated` rows, emits, then stamps. A crash leaves NULL, so the next tick re-emits (at-least-once; clients dedupe by `seq`). Independent of the Telegram `status` that Phase E will use for the same rows. |
| Gateway | Plain `socket.io` server on the API's Fastify HTTP server (`RealtimeModule`), `@socket.io/redis-adapter` in the API, `@socket.io/redis-emitter` in the worker. Versions checked against the official docs when building and recorded in `tech-stack.md`. |

Defaults applied (flag if you disagree):

- **Rooms:** one room per account, `user:<id>`, joined by the server on connect from the verified token. There is no client `join` / `subscribe` message, so there is no client-supplied id to abuse. The publisher computes recipients from the DB (the conversation's customer and the creator's user), which is what keeps one customer from seeing another's events.
- **Who gets what:** `message.created` → both participants (then `conversation.updated` to both, for lists and badges). `read.updated` → the *peer* of the reader (the "Dibaca" tick) and `conversation.updated` to the reader (their other devices' unread counts).
- **Stale events:** a row older than 15 minutes is stamped without emitting (clients refetch on reconnect anyway), so a long worker outage does not flood sockets.
- **Token lifetime:** the access token lives 1 h. The server rechecks every connected socket every 60 s (`authenticate`: session row, status, `session_version`, expiry). A failed check emits `session.ended` and disconnects; the client reconnects with a fresh token (its `auth` callback asks the API client, which renews through Telegram `initData` as today).
- **Immediate disconnect:** `AccountSecurityService` gets an optional after-commit callback (`onAccountChanged(userId)`) for block / unblock / role change; the API wires it to `io.in('user:<id>').disconnectSockets(true)`. The 60 s recheck is the safety net for any path that bypasses it (CLI, another process).
- **Offline banner:** the inbox panel shows when the browser is offline **or** the socket has been connected before and is now disconnected (text per the board: "Koneksi terputus" / "Menyambungkan ulang…"). Chat and list screens show no banner (not designed); they just catch up on reconnect.
- **Not built:** typing indicators (`typing.changed`), presence and Telegram notification suppression (Phase E), a per-user connection cap (Phase H, noted).

## Authorization & Data Rules

- Handshake: token only from `socket.handshake.auth.token` (never the URL); Origin checked against `ALLOWED_ORIGINS`; `authorizeConnection(auth, token, { roles: ['USER', 'CREATOR'] })`. Failure → `connect_error` with a code only (`UNAUTHENTICATED` / `FORBIDDEN_ROLE`), no detail. Admin tokens and forged tokens are `unauthenticated`.
- The socket's identity (`user.id`, `role`) comes from the live account row at connect and at every recheck; a role change while connected disconnects it (the new role may not be allowed to reuse the socket).
- Joined rooms: exactly `user:<authenticated id>`. Client events are ignored (no handlers). Server-side `fetchSockets` / `disconnectSockets` use the same room name.
- Publisher: recipients are read from `conversations` joined to `creators` (customer user id, creator user id) by the id in the outbox payload; an unknown conversation id (deleted data, forged row) is stamped and skipped. Payload entries are ids and numbers only (the outbox already enforces safe tokens).
- Idempotency / ordering: events are signals; duplicates and reordering are harmless because the client refetches and merges by `seq`. Emission happens only for rows that are already committed (the loop reads committed rows), so a rolled-back message never emits.
- Concurrency: `FOR UPDATE SKIP LOCKED` on the claim, so two publishers take different rows; the stamp is written after emit in the same short transaction.
- No new route and no new HTTP surface; the socket carries no write path (HTTP stays the only write path).
- Logs: user id and event type only, never tokens or message content.

## Dependencies

- New packages (exact versions pinned after checking the official docs/compat table at build time): `socket.io` and `@socket.io/redis-adapter` (apps/api), `@socket.io/redis-emitter` (apps/worker), `socket.io-client` (apps/miniapp). Reuses `ioredis` already in the API and worker.
- Env: none new. Reuses `REDIS_URL`, `ALLOWED_ORIGINS`; the Mini App derives the socket URL from the existing API base URL (no secret in any `VITE_*`).
- Prior stories present: US-006 (`authorizeConnection`, `AccountSecurityService`), US-012/013 (outbox, worker loops), US-026/029 (message commits), US-030 (read cursor and `read.updated` outbox event), US-027/028 (list, inbox, `UnreadProvider`).
- Migration: new folder after `20261128010000`.
- Proxy note for later deployment: WebSocket upgrade must be forwarded; not part of this story (local only).

## Risks

- **Fastify + Socket.IO wiring:** attaching to the Nest/Fastify HTTP server after `app.listen` ordering and shutdown. Mitigation: build the server from `app.getHttpServer()` in `createApp`, close it in `app.close()`, and cover startup and shutdown in an integration test (the existing test app helper must still close cleanly).
- **Shared test Redis / DB:** the adapter and emitter use a test key prefix so parallel sessions do not cross-talk; tests clean their keys.
- **At-least-once duplicates:** two quick events cause two refetches. Mitigation: client coalesces refreshes (one in flight per conversation, trailing re-run) and throttles list refetches.
- **Missed events while disconnected:** by design; every `connect` (including the first reconnect) refetches the open chat, the list / inbox page 1 and the unread counts over HTTP.
- **Token expiry loops:** a socket that keeps failing auth could reconnect-storm. Mitigation: Socket.IO's backoff, and the client stops retrying when the API client reports the session lost (existing `onSessionLost`).
- **Real Telegram WebView:** WebSocket behaviour inside Telegram's WebView is only checked manually and reported, not claimed; polling fallback stays enabled.
- **Event volume per message:** 2 users × 2 events. Acceptable for MVP; revisit in Phase H.

## Tasks

### TASK-179: Realtime contracts

`packages/contracts/src/realtime.ts` (re-export from `index.ts`):

- `REALTIME_PATH = '/realtime'` (Socket.IO path), `userRoom = (id: string) => \`user:${id}\``.
- Server → client events as a typed map: `message.created {conversation_id: uuid, seq: int ≥ 1}`, `read.updated {conversation_id: uuid, through_seq: int ≥ 0}`, `conversation.updated {conversation_id: uuid}`, `session.ended {}`. Schemas are strict; `RealtimeEventName` union and `RealtimeEvents` type for `socket.io` generics.
- Client → server: none. Handshake: `RealtimeAuthSchema = { token: string }`; connect error data `{ code: 'UNAUTHENTICATED' | 'FORBIDDEN_ROLE' }`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/realtime.ts` | Event schemas, path, room helper |
| CREATE | `packages/contracts/src/realtime.spec.ts` | Schema tests |
| MODIFY | `packages/contracts/src/index.ts` | Export |

**Testing:**
- Each event parses its exact shape; an extra key (`body`, `preview`, `customer_id`), a non-uuid id, `seq: 0` fail.
- `userRoom` is stable; the handshake rejects a missing or empty token.

---

### TASK-180: Schema and migration for the delivery marker

- `OutboxEvent.realtimePublishedAt DateTime? @map("realtime_published_at") @db.Timestamptz(3)`.
- Migration `20261129010000_outbox_realtime`: `ALTER TABLE outbox_events ADD COLUMN realtime_published_at timestamptz(3)`; partial index `outbox_events_realtime_pending_idx ON outbox_events (created_at) WHERE realtime_published_at IS NULL AND type IN ('message.created', 'read.updated')`; **backfill** `UPDATE outbox_events SET realtime_published_at = now() WHERE type IN ('message.created','read.updated')` so existing rows are not emitted.
- Dev DB: `prisma migrate deploy`; never reset. Test DB via the test setup.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/db/prisma/schema.prisma` | Column |
| CREATE | `packages/db/prisma/migrations/20261129010000_outbox_realtime/migration.sql` | Column, index, backfill |
| CREATE | `packages/db/test/outbox-realtime.int.spec.ts` | Column and index tests |

**Testing:**
- New rows default to NULL; existing message / read rows are stamped by the migration SQL (run the backfill statement on seeded rows); other event types stay NULL; the partial index exists.

---

### TASK-181: `RealtimePublisher` in backend-core

`packages/backend-core/src/realtime/realtime-publisher.ts` (+ `index.ts`, exported from the package index):

```ts
export interface RealtimeEmitter { emit(room: string, event: RealtimeEventName, payload: object): Promise<void> | void }
class RealtimePublisher {
  constructor(prisma, emitter: RealtimeEmitter, opts?: { clock?, batch?: 50, staleMs?: 15 * 60_000 })
  publishPending(): Promise<{ published: number; skipped: number; failed: number }>
}
```

- In one transaction: select up to `batch` rows `WHERE realtime_published_at IS NULL AND type IN (…) ORDER BY created_at FOR UPDATE SKIP LOCKED`.
- Per row: older than `staleMs` → stamp, skip. Else resolve `{customerUserId, creatorUserId}` from `conversations` ⨝ `creators` by `payload.conversation_id`; none → stamp, skip. `message.created`: emit `message.created` and `conversation.updated` to both rooms (seq from the message row by `payload.message_id`). `read.updated`: `read.updated` to the peer of `payload.reader_id` and `conversation.updated` to the reader; a reader who is not a participant → stamp, skip.
- If an emit throws, leave that row unstamped (retried next tick), keep going with the others, count `failed`; never log payload content.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/realtime/realtime-publisher.ts` | Claim, resolve, emit, stamp |
| CREATE | `packages/backend-core/src/realtime/index.ts` | Barrel |
| MODIFY | `packages/backend-core/src/index.ts` | Export |
| CREATE | `packages/backend-core/src/realtime/realtime-publisher.int.spec.ts` | Integration tests (fake emitter) |

**Testing (real PostgreSQL, recording emitter):**
- A committed customer message emits to both rooms only (customer A of creator X: customer B's room gets nothing); a creator reply likewise; payloads are exactly the contract shapes (no body / name).
- `read.updated` goes to the peer, `conversation.updated` to the reader.
- A rolled-back message transaction (no outbox row) emits nothing; a pending row stays unstamped until the loop runs; stamped rows are never re-emitted.
- Crash simulation: emitter throws on the first call → row stays NULL → next call emits and stamps (no loss); a throwing emit for one row does not block the others.
- Two publishers racing over 20 rows emit each row once (SKIP LOCKED).
- Stale row (> 15 min) stamped without emit; unknown conversation or non-participant reader stamped and skipped.

---

### TASK-182: Worker wiring

`apps/worker/src/realtime.ts`: `startRealtime({ env, prisma, logger, ... })` creates an `ioredis` client and a `@socket.io/redis-emitter` `Emitter` (key prefix configurable for tests), adapts it to `RealtimeEmitter` (`emitter.to(room).emit(event, payload)`), and runs `publishPending` every 1 s through the existing `startOutboxLoops` pattern (non-reentrant, logs only on healthy → failing). It runs whether or not Telegram is configured (unlike `startNotifications`). `main.ts` starts it and stops it on shutdown.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/worker/src/realtime.ts` | Emitter adapter and loop |
| MODIFY | `apps/worker/src/main.ts` | Start / stop |
| MODIFY | `apps/worker/package.json`, `pnpm-lock.yaml` | Pinned `@socket.io/redis-emitter` |
| CREATE | `apps/worker/src/realtime.int.spec.ts` | Loop test against real Redis |

**Testing:**
- With a real Redis, a socket.io server using the redis adapter (test prefix) receives the event after a committed message within the interval; a failing tick does not stop the loop; stop() waits for a running tick and closes Redis.

---

### TASK-183: Socket.IO gateway in the API

`apps/api/src/modules/realtime/` (`realtime.module.ts`, `realtime.service.ts`, `tokens.ts`); `createApp` attaches the server to `app.getHttpServer()` and closes it on `app.close()`.

- `new Server(httpServer, { path: REALTIME_PATH, cors: { origin: env.ALLOWED_ORIGINS }, serveClient: false })` + `createAdapter(pub, sub)` from two `ioredis` duplicates (test key prefix configurable).
- `io.use`: read `auth.token` (zod `RealtimeAuthSchema`), `authorizeConnection(userAuth, token, { roles: ['USER', 'CREATOR'] })`; on success store `{userId, role, token}` in `socket.data` and `socket.join(userRoom(userId))`; on failure `next(Object.assign(new Error('refused'), { data: { code } }))`.
- Recheck timer (`REALTIME_RECHECK_MS`, default 60 000, injectable): for every socket re-run `authenticate(token)` (and compare the role); on failure emit `session.ended` and `socket.disconnect(true)`.
- `disconnectUser(userId)`: `io.in(userRoom(userId)).disconnectSockets(true)`. `AccountSecurityService` (backend-core) takes an optional `onAccountChanged?: (userId: string) => void` called after the transaction commits in `blockUser`, `unblockUser` and `changeRole`; `AdminModule` / the account-security provider passes `realtime.disconnectUser`.
- No client event handlers are registered.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/realtime/realtime.service.ts` | Server, auth, rooms, recheck, disconnect |
| CREATE | `apps/api/src/modules/realtime/realtime.module.ts`, `tokens.ts` | Wiring |
| MODIFY | `apps/api/src/app.factory.ts`, `app.module.ts` | Attach and close |
| MODIFY | `packages/backend-core/src/account-security/account-security.service.ts` (+ spec) | After-commit callback |
| MODIFY | `apps/api/package.json`, `pnpm-lock.yaml` | Pinned `socket.io`, `@socket.io/redis-adapter` |
| CREATE | `apps/api/test/realtime.int.spec.ts` | Gateway tests with a real `socket.io-client` |

**Testing (real app, DB, Redis):**
- No token / garbage / admin token / forged token → `connect_error` with a code and no detail; a blocked account and a stale `session_version` are refused; an ADMIN-role-less path (role not USER / CREATOR) → `FORBIDDEN_ROLE`; the token in the URL query is ignored.
- An open socket is disconnected within a second of `blockUser` and of `changeRole`; reconnecting with the old token is refused; the 60 s recheck (shortened in the test) disconnects after a revoked session or an expired token, with `session.ended` first.
- Room isolation: customers A and B of one creator connect; a message in A's conversation (through the real publisher and worker emitter) reaches A and the creator, never B; a client emitting `join` / any event with another user's room or id gets nothing.
- Shutdown: `app.close()` closes the server and Redis clients (no open handles); the existing API suites stay green.

---

### TASK-184: Mini App socket client and provider

- Add `socket.io-client` (pinned). `apps/miniapp/src/realtime/`:
  - `RealtimeProvider` (inside `AuthProvider`, only while authenticated as USER or CREATOR): creates the socket with `auth: (cb) => cb({ token })` where the token comes from a new `api.getAccessToken()` (returns the in-memory token, renewing through the existing exchange when expired); `path: REALTIME_PATH`; `transports: ['websocket', 'polling']`; URL from the API base URL. Disconnects on logout / session loss / role change.
  - Exposes `useRealtimeStatus()` → `'connecting' | 'connected' | 'disconnected'` plus `hasConnected` (true after the first connect) and `useRealtimeEvent(name, handler)` (parsed with the contract schemas; invalid payloads dropped) and `useReconnect(handler)` (fires on every connect after the first, and on `session.ended` + successful reconnect).
  - A fake (`test/fake-realtime.ts`) with `emit(name, payload)`, `connect()`, `disconnect()` for specs; `createMiniappRoutes` accepts an optional `realtime` factory (like `telegram`) so tests and the visual harness inject it; the default is the real client.
- `MiniappApi.getAccessToken()` added to the interface, the client and the fake.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/realtime/RealtimeProvider.tsx` | Socket lifecycle, status, hooks |
| CREATE | `apps/miniapp/src/realtime/socket.ts` | Real client factory |
| CREATE | `apps/miniapp/test/fake-realtime.ts` | Test double |
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec) | `getAccessToken()` |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | Provider and optional factory (re-read the file first: other sessions edit it) |
| MODIFY | `apps/miniapp/test/fake-miniapp-api.ts` | `getAccessToken` |
| CREATE | `apps/miniapp/src/realtime/RealtimeProvider.spec.tsx` | Provider tests |
| MODIFY | `apps/miniapp/package.json`, `pnpm-lock.yaml` | Pinned `socket.io-client` |

**Testing:**
- Connects with a token only when authenticated; never for a signed-out visitor; reconnect uses the renewed token; logout and session loss disconnect; the status transitions connecting → connected → disconnected → connected; `useReconnect` fires on the second connect and not on the first; a malformed payload is ignored; a CREATOR and a USER both connect.

---

### TASK-185: Live screens, reconnect catch-up and the offline panel

- **Open chat (customer `ChatPage`, creator `CreatorChatPage`):** `useThread` subscribes to `message.created` and `read.updated` for its own `conversation_id` and calls `refresh()` (existing: fetch newest page, gap detection, merge by `seq`). Refreshes are coalesced (one in flight, one trailing re-run). On reconnect: `refresh()` and re-post every unsent bubble that is `failed` or stuck `sending` with the **same `client_message_id`** (the existing `post()` guard prevents double sends; the server replays an already stored one).
- **Lists:** `useChatList` and `useInbox` refetch page 1 on `conversation.updated` (throttled to once per 2 s, replacing the list; de-dup stays) and on reconnect; `UnreadProvider` refetches on `conversation.updated` (keeping its 5 s route throttle for navigation only) and on reconnect.
- **Offline panel:** `useOnline()` becomes `useConnection()` = browser online AND (socket not disconnected-after-having-connected). The inbox shows the `CrStatesInbox` offline panel ("Koneksi terputus" with "Menyambungkan ulang…") from it; the rows dim as today. Chat and list screens show nothing.
- Existing behaviour that stays: refetch when the tab becomes visible.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/chat/useChat.ts` | Event and reconnect hooks, coalescing, unsent retry |
| MODIFY | `apps/miniapp/src/chats/useChatList.ts`, `UnreadProvider.tsx` | Live refetch |
| MODIFY | `apps/miniapp/src/inbox/useInbox.ts`, `useOnline.ts` → `useConnection.ts`, `InboxPage.tsx` | Live refetch, banner source |
| MODIFY | `apps/miniapp/src/chat/*.spec.tsx`, `inbox/*.spec.tsx`, `chats/*.spec.tsx` | Add realtime cases; no existing expectation changes |
| CREATE | `apps/miniapp/src/realtime/live-screens.spec.tsx` | Cross-screen catch-up tests with the fake socket |

**Testing:**
- A `message.created` for the open conversation adds the bubble without a reload and without duplicates (two identical events → one bubble); an event for another conversation does nothing.
- `read.updated` updates the "Dibaca" marker; the list shows the new preview, order and unread count after `conversation.updated`; the nav badge follows.
- Reconnect after a gap of more than one page restarts from the newest page (no hole); an unsent bubble that failed while offline is re-posted once with the same id and ends as one message; the server replay of an already stored one shows one bubble.
- Inbox shows the offline panel on socket disconnect and on the browser `offline` event, and removes it on reconnect; the chat screen shows no banner.
- No AI / Manual text or ids appear because of events.

---

### TASK-186: End-to-end checks, visual and docs

- End-to-end integration test (`apps/api/test/realtime.e2e.int.spec.ts`): a customer and a creator connect with real tokens; the customer sends over HTTP; after one publisher tick both receive `message.created` / `conversation.updated` and refetching returns the message; the creator replies and reads; the customer receives `read.updated`; a third user receives nothing; reconnect catch-up (disconnect the client, send two messages, reconnect, HTTP history from the last seq has both, no duplicate).
- Playwright: the `miniapp-inbox-offline` item keeps passing with the new source (inject the fake socket state or keep the browser-offline route); re-run `miniapp-inbox*` and `miniapp-chat*`.
- Docs: `codebase-map.md` (migration, gateway, publisher, events table in "Socket Events", env, feature backlog), `tech-stack.md` decisions log (payload, marker column, gateway, versions pinned, recheck interval, stale-event rule), `design-integration.md` Known Gaps (offline wording for the reconnecting state, no banner on chat/list), and a short manual checklist for the real Telegram WebView (not claimed as verified).
- `README.md` / `CONFIGURATION.md`: no new env; note that the worker must run for live updates.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/test/realtime.e2e.int.spec.ts` | Two-user and reconnect flow |
| MODIFY | `visual/specs/visual.spec.ts` | Only if the offline item needs the socket seam |
| MODIFY | `.agile/guidelines/codebase-map.md`, `tech-stack.md`, `design-integration.md` | Keep in sync |

**Testing:**
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; `pnpm visual -g "miniapp-inbox|miniapp-chat"` passes with unchanged differences; the manual WebView check is listed as "not done".

---
