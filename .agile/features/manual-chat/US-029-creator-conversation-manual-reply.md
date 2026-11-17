# US-029: Creator conversation, manual reply and customer detail

**Status:** ready_for_uat
**Priority:** high
**Feature:** manual-chat
**Phase:** C
**Roles:** CREATOR, System
**Brief refs:** §6 (no new activity to a customer without active access), §7 (manual send; creator-side source metadata allowed), §10 (Conversation, customer detail), §14
**Design refs:** `CrChatManual`, `CrChatExpired`, `CrCustomer`

## Description

As a CREATOR, I want to open a conversation and reply in text, and see the customer's access period, so that I can serve my subscribers personally.

## Acceptance Criteria

- [ ] `/inbox/:conversationId` shows the conversation in the `CrChatManual` layout: header (customer, "Akses aktif hingga …"), day separators, bubbles with times in my display zone, composer with the same Mengirim… / Belum terkirim / Kirim Ulang states and cursor history. The Manual/AI panel and "Aktifkan AI" are Phase F and not shown yet.
- [ ] Sending uses the same HTTP + `client_message_id` + outbox rules as US-026 (idempotent retry, one row). Messages are stored with origin MANUAL so Phase F can label them.
- [ ] When the customer's access is not active, the screen matches `CrChatExpired`: "Akses berakhir · AI tidak membalas dan broadcast baru tidak diterima.", history readable, composer replaced by "Akses pelanggan telah berakhir. Masa akses dikelola admin." The server also refuses a creator send in that state (403, nothing stored).
- [ ] `/inbox/:conversationId/customer` matches `CrCustomer` for the access part: name, `@username · dari Telegram`, "Akses aktif hingga …", "Berakhir pukul 23.59 WIB · dikelola admin", Buka Chat. The AI card is Phase F. No Telegram numeric ID, no other creators' data.
- [ ] Only the creator of the conversation can read or send: another creator's conversation id → 404; a USER token → 403; a blocked creator → 401. Screenshots at 390 px match the boards (minus Phase F panels).

## Tasks

### TASK-167: Creator chat contracts
**Status:** done

### TASK-168: `messages.origin` migration and seed check
**Status:** done

### TASK-169: `CreatorChatService` in backend-core
**Status:** done

### TASK-170: API endpoints
**Status:** done

### TASK-171: Mini App data layer and shared chat pieces
**Status:** done

### TASK-172: Mini App screens `CrChatManual`, `CrChatExpired`, `CrCustomer`
**Status:** done

### TASK-173: Visual check and docs
**Status:** done

