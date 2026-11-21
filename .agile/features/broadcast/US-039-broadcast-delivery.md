# US-039: Broadcast delivery to every active subscriber

**Status:** ready_for_uat
**Priority:** high
**Feature:** broadcast
**Phase:** E
**Roles:** System, USER, CREATOR
**Brief refs:** §6 (new broadcasts only with active access), §9 (snapshot, re-check before delivery, one message per conversation linked to the broadcast, recipient states, replies private, no AI trigger), §14 (outbox, transactional per recipient, worker idempotency), §17 (retries create one persisted message per intended delivery)
**Design refs:** `Chat` / `MediaPhoto` / `MediaVideo` (customer bubble and viewer, from US-037), `CrChatExpired` ("AI tidak membalas dan broadcast baru tidak diterima."); customer broadcast label not designed — gap

## Description

As a USER with active access, I want a creator's broadcast to arrive in my private chat with that creator like any other message, so that I can see it, open the media and reply privately.

## Acceptance Criteria

- [ ] When a broadcast is recorded, the worker (through the outbox) snapshots the creator's customers with ACTIVE access at the start of the fan-out and records one recipient row per customer (PENDING → DELIVERED / SKIPPED / FAILED).
- [ ] Each delivery runs in its own transaction: re-checks the customer's access, account status and the creator's status; if still allowed it writes exactly one creator message (media attachment pointing to the broadcast's asset + optional text) in that customer's conversation (created if missing), linked to the broadcast, and emits `message.created` after commit. Otherwise the recipient is SKIPPED with a reason and no message is written.
- [ ] Customers whose access is EXPIRED, revoked or still PENDING, blocked customers and customers who subscribe after the snapshot receive nothing; a creator blocked mid-fan-out stops the remaining deliveries.
- [ ] Idempotency: re-running the job, a worker crash or a duplicate outbox dispatch never creates a second message for the same broadcast + recipient (unique per broadcast and recipient); FAILED recipients are retried with backoff and a cap.
- [ ] The customer sees the message in `/chats/:conversationId`, the chat list and the unread count, opens its media in the viewer (US-037 rules: still viewable after expiry), and the attachment authorizes reading that asset only for recipients who got the message. A reply from the customer is a normal private message; the broadcast itself never enqueues an AI reply or changes the AI/Manual mode.
- [ ] The creator sees the broadcast message in each recipient's conversation in the inbox (no per-recipient composer). Integration test: N active + M expired customers → exactly N messages, 0 for the others, same result after a forced retry.

## Tasks

### TASK-228: Shared creator message writer
**Status:** done

### TASK-229: `BroadcastFanOutService`
**Status:** done

### TASK-230: Worker broadcast pipeline, end-to-end test and docs
**Status:** done
