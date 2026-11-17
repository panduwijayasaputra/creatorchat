# US-026: Customer private chat: read history and send text

**Status:** ready_for_uat
**Priority:** high
**Feature:** manual-chat
**Phase:** C
**Roles:** USER, System
**Brief refs:** §6 (send needs active access; history readable after expiry unless the account is blocked), §7 (one conversation per pair; text only for customers; cursor pagination; sending/failed/retry; `client_message_id`), §14 (HTTP write path, outbox), §17
**Design refs:** `Chat`, `ChatExpired`, `StatesAccess` (Chat · riwayat loading)

## Description

As a USER, I want to read my chat history with a creator and send text messages, so that I can talk to them privately while my access is active.

## Acceptance Criteria

- [ ] `/chats/:conversationId` matches `Chat`: header with creator and "Akses aktif hingga …", day separators ("Hari ini", "Kemarin", dates), bubbles with times in my display zone, my sent states **Mengirim…**, **Belum terkirim** + **Kirim Ulang**, and older history loaded by cursor when scrolling up ("Memuat riwayat…" from `StatesAccess`). No AI/Manual label appears anywhere on the customer side.
- [ ] Sending posts over HTTP with a client-generated `client_message_id`; the server writes the message and an outbox event in one transaction and returns it. Retrying the same id (Kirim Ulang, network retry, double tap) returns the **same** message — one row, no duplicate bubble. Empty/whitespace text and text over the agreed limit → 400.
- [ ] The server re-checks access on every send: expired, revoked, creator blocked or my account blocked → refused (403 with a specific code; 401 for my own block) and nothing is stored. The screen then switches to `ChatExpired`: history kept, composer replaced by "Akses telah berakhir … Minta Perpanjangan Akses" (US-023).
- [ ] With expired or revoked access I can still open and scroll the full history (`ChatExpired`). Only the two participants can read a conversation: another user's conversation id → 404, a CREATOR token on customer routes → 403.
- [ ] Integration tests: idempotent retry, send refused after expiry/revoke/creator block, history pagination is stable when new messages arrive, IDOR returns 404. Screenshots at 390 px match `Chat` (text bubbles; media bubbles are Phase D) and `ChatExpired`.

## Tasks

### TASK-147: Chat contracts and error codes
**Status:** done

### TASK-148: Prisma schema and migration for messages
**Status:** done

### TASK-149: `ChatService` in backend-core (history + send)
**Status:** done

### TASK-150: API endpoints
**Status:** done

### TASK-151: Mini App chat data layer
**Status:** done

### TASK-152: Mini App chat screen (`Chat`, `ChatExpired`, loading state)
**Status:** done

### TASK-153: Seed fixtures, visual check and docs
**Status:** done
