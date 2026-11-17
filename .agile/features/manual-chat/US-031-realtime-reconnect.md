# US-031: Realtime updates and reconnect

**Status:** ready_for_uat
**Priority:** high
**Feature:** manual-chat
**Phase:** C
**Roles:** USER, CREATOR, System
**Brief refs:** §3 (stale sessions lose privilege; check status and session version on socket), §7 (history not lost on disconnect; reconnect fetches over HTTP), §14 (Socket.IO emits committed events `message.created`, `conversation.updated`, `read.updated`; server-derived rooms; outbox + reconciler)
**Design refs:** `CrStatesInbox` (Offline, menyambungkan ulang), `Chat`, `Chats`, `CrInbox`

## Description

As a USER or CREATOR, I want new messages and read updates to appear without refreshing, and nothing to be lost when my connection drops, so that chatting feels live and reliable.

## Acceptance Criteria

- [ ] A Socket.IO gateway authenticates the app session with `authorizeConnection()` (US-006): blocked accounts, role changes and stale `session_version` are refused, and an open socket is disconnected when the account is blocked or its role changes. Room membership is derived on the server (my user room / my conversations), never from a client-supplied id.
- [ ] Only committed data is emitted: after a message or read commit, the outbox dispatcher (worker) publishes `message.created`, `conversation.updated` and `read.updated` to the right participants only. Unpublished outbox events are picked up by the reconciler after a crash.
- [ ] Open chat, chat list and inbox update live (new bubble, preview, order, unread). A user never receives events for a conversation they don't belong to (test with two customers of one creator).
- [ ] On disconnect the inbox shows the `CrStatesInbox` offline banner ("Koneksi terputus · Menyambungkan ulang…"); on reconnect the client refetches over HTTP from its last known message and unsent messages are retried with the same `client_message_id` — no gaps and no duplicates.
- [ ] Event payloads are defined in `packages/contracts`. Integration tests cover: room isolation, refused connection after block, reconnect catch-up. Real Telegram WebView behavior is checked manually and reported, not claimed.

## Tasks

### TASK-179: Realtime contracts
**Status:** done

### TASK-180: Schema and migration for the delivery marker
**Status:** done

### TASK-181: `RealtimePublisher` in backend-core
**Status:** done

### TASK-182: Worker wiring
**Status:** done

### TASK-183: Socket.IO gateway in the API
**Status:** done

### TASK-184: Mini App socket client and provider
**Status:** done

### TASK-185: Live screens, reconnect catch-up and the offline panel
**Status:** done

### TASK-186: End-to-end checks, visual and docs
**Status:** done

