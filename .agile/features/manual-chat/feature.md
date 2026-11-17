# Feature: manual-chat

**Phase:** C — Access & manual chat
**Roles:** USER, CREATOR, System
**Brief refs:** §6 (sending needs active access; received messages stay readable), §7 (one conversation per USER–CREATOR; customer text only in MVP; cursor pagination, unread, timestamps, sending/failed/retry; `client_message_id`), §10, §14 (HTTP write path, outbox, Socket.IO emits committed events only, server-derived rooms, re-check on join, reconnect refetches over HTTP), §15, §17
**Design refs:** `Chats`, `StatesChats`, `Chat`, `ChatExpired`, `StatesAccess` (Chat · riwayat loading), `CrInbox`, `CrStatesInbox`, `CrChatManual`, `CrChatExpired`, `CrCustomer`

## Overview

Persisted one-to-one text chat between a customer and a creator. Messages are written over HTTP in a transaction (idempotent by `client_message_id`), then an outbox event drives realtime delivery; Socket.IO only announces committed events and clients refetch over HTTP after reconnecting. Sending requires active access (the `customer-access` entitlement rule) for the customer, and the creator can reply only while the customer's access is active. History stays readable after expiry.

Phase C is **manual only**: no AI replies yet. The conversation `mode` and `response_version` columns can be created now, but the AI/Manual panel, "Aktifkan AI", the "AI Aktif" chips, the "Manual" and "Perlu Perhatian" inbox filters and the `CrCustomer` AI card come in Phase F. Media in chat (attach, gallery pick, media bubbles, viewer) comes in Phase D. Bot notifications for new messages come in Phase E.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-026 | Customer private chat: read history and send text | high |
| US-027 | Customer chat list | high |
| US-028 | Creator inbox | high |
| US-029 | Creator conversation, manual reply and customer detail | high |
| US-030 | Read receipts and unread counts | medium |
| US-031 | Realtime updates and reconnect | high |

## Depends on

- `customer-access` (US-020 creates the conversation on first grant; entitlement rule).
- US-006 `authorizeConnection()` for the socket gateway.
- US-009 `formatDateTime` / `formatTime` for every timestamp in the account's display zone.

## Decisions to confirm with the Tech Lead

- Customers send text only (brief §7). The creator side in Phase C is also text only; creator media is Phase D.
- Typing indicator (`typing.changed`, brief §14) has no designed UI → not built.
- A creator cannot reply to an expired customer (`CrChatExpired` has no composer: "Masa akses dikelola admin.").

## Design gaps

- No designed state for "creator account blocked" inside a customer's chat; use the `ChatExpired` composer-replacement pattern with placeholder copy and report it.
- Message length limit is not designed; tech lead proposes a value (open input).
