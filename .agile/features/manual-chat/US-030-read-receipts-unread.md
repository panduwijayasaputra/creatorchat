# US-030: Read receipts and unread counts

**Status:** ready_for_uat
**Priority:** medium
**Feature:** manual-chat
**Phase:** C
**Roles:** USER, CREATOR
**Brief refs:** §7 (unread), §13 (ConversationRead: participant/conversation UNIQUE, read cursor), §14 (`read.updated`)
**Design refs:** `Chat` ("Dibaca"), `Chats`, `CrInbox` (unread badges, "Belum Dibaca n")

## Description

As a USER or CREATOR, I want unread counts to clear when I read a chat and to see when my message was read, so that I know what still needs attention.

## Acceptance Criteria

- [ ] Opening a conversation (and new messages arriving while it is open and visible) advances my read cursor over HTTP; the cursor only moves forward (an older cursor from a slow request never moves it back).
- [ ] Unread counts in `Chats`, `CrInbox`, the "Belum Dibaca n" chip and the bottom-nav badges come from the server (messages from the other participant after my cursor) and update after reading.
- [ ] The customer sees **Dibaca** under their latest message the creator has read, as in `Chat`. Whether the creator side shows a read marker follows the design (none on `CrChatManual`).
- [ ] I can only move my own cursor in a conversation I belong to (another conversation → 404). Integration test: two participants, interleaved sends and reads, counts are correct.

## Tasks

### TASK-174: Read contracts
**Status:** done

### TASK-175: `ConversationReadService` in backend-core
**Status:** done

### TASK-176: API endpoints
**Status:** done

### TASK-177: Mini App: mark as read, "Dibaca", creator badge
**Status:** done

### TASK-178: Visual check and docs
**Status:** done
