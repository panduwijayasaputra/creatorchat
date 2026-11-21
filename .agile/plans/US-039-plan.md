# Technical Plan: US-039 — Broadcast delivery to every active subscriber

## Architecture Overview

Agreed with the user (2026-11-21). The worker turns one `broadcasts` row into one creator message per active subscriber, each in its own transaction.

```
outbox broadcast.created ─▶ OutboxDispatcher (handledTypes: broadcast.created) ─▶ BullMQ `broadcast` queue
   └─ BroadcastProcessor(eventId)
        1. start(): lock broadcast → QUEUED? snapshot recipients (one INSERT … SELECT over active entitlement)
                    → FANNING_OUT, snapshot_at, recipient_count
        2. loop deliverBatch(50): each recipient = own transaction
              lock recipient row → lock conversation → re-check access/accounts
              → writeCreatorMessage(...) (shared writer) → DELIVERED | SKIPPED(reason)
        3. no PENDING left → COMPLETED, outbox event DONE
        time box ~20 s per job: not finished → event back to PENDING (available_at now) → next job continues
```

- **Retries live in PostgreSQL** (as US-013): the job always completes; `broadcast_recipients` states and the outbox row are the truth. A lost Redis job → the existing reconciler resets the stale `ENQUEUED` event.
- **One message per recipient, three layers:** `broadcast_recipients PK (broadcast_id, customer_id)`; `messages` unique index `(broadcast_id, conversation_id)`; deterministic `client_message_id = broadcast_recipients.id` with the existing `(conversation, sender, client_message_id)` unique constraint.
- **Shared message writer** (TASK-228): the sequence / message / attachment / outbox part of `CreatorChatService.send` becomes `writeCreatorMessage(tx, …)` so broadcast and welcome (US-041) write messages exactly like a manual send, without the HTTP-specific checks.
- **No AI, no mode change:** the writer never touches `mode` or `response_version`; no AI event is written (AI is Phase F and triggers on inbound customer messages only).
- Every message gets the normal `message.created` outbox event, so realtime (US-031) and Telegram notifications (US-042) work unchanged.

Brief refs: §6, §9, §14, §17. Design refs: `Chat`, `MediaPhoto`, `MediaVideo`, `CrChatExpired`; customer broadcast label not designed — messages look like any creator media message.

## Authorization & Data Rules

- No HTTP surface. The worker reads the creator, asset, text and recipients from the database by `broadcast_id`; the outbox payload is never trusted.
- Snapshot = customers with `starts_at <= now < ends_at`, not revoked, customer ACTIVE, creator ACTIVE (+ creator user ACTIVE) at the moment `start()` runs. Later subscribers receive nothing; the snapshot is never recomputed (a re-run of `start()` on a non-QUEUED broadcast is a no-op).
- Per-recipient re-check inside the delivery transaction, after the conversation lock: same entitlement predicate + customer ACTIVE + creator ACTIVE + creator user ACTIVE. Failure → `SKIPPED` with a code: `access_ended`, `customer_blocked`, `creator_blocked`. A creator blocked mid-way skips all remaining recipients (`creator_blocked`).
- Missing conversation (customer without a conversation row) is created idempotently (`INSERT … ON CONFLICT (customer_id, creator_id) DO NOTHING`) inside the delivery transaction.
- Transient errors (deadlock, connection) leave the recipient PENDING with `attempts + 1`; at 5 attempts → `FAILED` `delivery_error`. A FAILED recipient never blocks COMPLETED.
- Locks: recipient row first, then conversation (same order everywhere) — two workers on the same broadcast take disjoint rows with `FOR UPDATE SKIP LOCKED` when picking a batch.
- Media access for recipients needs no new rule: the attachment belongs to a message in their own conversation (US-037's ownership check); the asset's gallery membership is irrelevant.
- Logs: broadcast id, counts, outcome codes — never the text.

## Dependencies

- US-038 (tables, event, assets), US-031 (realtime publisher already handles `message.created`), US-037 (customer media bubble), US-026/US-029 (message write path), US-013 (dispatcher/reconciler pattern), media pipeline pattern in `apps/worker/src/media`. No new packages / env.

## Risks

- **Large audiences:** batches of 50 with short transactions keep locks brief; the time box prevents one job from monopolising the worker.
- **Refactor of the send path:** `writeCreatorMessage` must keep US-029/US-036 behaviour → their integration suites run unchanged first.
- **Crash between snapshot and first delivery:** `FANNING_OUT` + PENDING rows resume on the next job; no snapshot rebuild.

## Tasks

### TASK-228: Shared creator message writer

Extract from `CreatorChatService.send` (the part after the access/attachment checks) into `packages/backend-core/src/chat/message-writer.ts`:
`writeCreatorMessage(tx, { conversationId, creatorUserId, clientMessageId, body: string | null, assetId: string | null, broadcastId?: string, now }, outbox): Promise<MessageRow>` — increments `conversations.last_message_seq` / `last_message_at` / `updated_at`, inserts the message (`type` TEXT or MEDIA, `origin MANUAL`, `broadcast_id`), the `message_attachments` row (`position 0`) and the `message.created` outbox event (payload `message_id`, `conversation_id`, `sender_id`; dedupe `message:<id>:created`). The caller holds the conversation lock. `CreatorChatService.send` calls it; behaviour and tests unchanged.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/chat/message-writer.ts` | shared writer |
| MODIFY | `packages/backend-core/src/creator-chat/creator-chat.service.ts` | use it |
| MODIFY | `packages/backend-core/src/chat/index.ts` | export |

**Testing:** `creator-chat.service.int.spec.ts`, `creator-chat-media.int.spec.ts`, `realtime.int.spec.ts` pass unchanged; writer unit/integration: seq increments by 1, MEDIA with attachment, `broadcast_id` stored, second insert with the same `(broadcast, conversation)` violates the unique index.

---

### TASK-229: `BroadcastFanOutService`

`packages/backend-core/src/broadcast/fan-out.service.ts`:
- `start(broadcastId): Promise<'started' | 'already_started' | 'missing'>` — one transaction: `SELECT … FROM broadcasts WHERE id = $1 FOR UPDATE`; if `status = 'QUEUED'`: `INSERT INTO broadcast_recipients (broadcast_id, customer_id) SELECT $1, s.customer_id FROM subscriptions s JOIN users u … JOIN creators c … WHERE entitlement predicate ON CONFLICT DO NOTHING`; set `status FANNING_OUT`, `snapshot_at = now`, `recipient_count`.
- `deliverBatch(broadcastId, limit = 50): Promise<{ delivered, skipped, failed, remaining }>` — pick PENDING ids `FOR UPDATE SKIP LOCKED LIMIT n` in a short transaction **only to select ids**, then `deliverOne(broadcastId, customerId)` per id in its own transaction (lock recipient row `WHERE status = 'PENDING'` → lock conversation → re-check → `writeCreatorMessage` with `clientMessageId = recipient.id`, `broadcastId` → mark DELIVERED with `message_id`; skip codes as above; unexpected error → caught outside the transaction, `attempts + 1` or `FAILED`).
- `finish(broadcastId): Promise<boolean>` — no PENDING left → `COMPLETED`, `completed_at`.
- `BroadcastProcessor.run(eventId, {budgetMs})` in `packages/backend-core/src/broadcast/broadcast-processor.ts`: `start` → loop `deliverBatch` until `remaining = 0` or budget exhausted → `finish`; returns `'done' | 'continue'`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/broadcast/fan-out.service.ts` (+ int spec) | snapshot + deliveries |
| CREATE | `packages/backend-core/src/broadcast/broadcast-processor.ts` | event-level loop |
| MODIFY | `packages/backend-core/src/broadcast/index.ts`, `src/index.ts` | exports |

**Testing (integration, real DB):**
- N active + M expired + K revoked + 1 blocked customer → exactly N messages (one per active conversation, same asset in `message_attachments`), recipients DELIVERED = N; M/K/1 are not in the snapshot.
- Customer expires between snapshot and delivery → that recipient SKIPPED `access_ended`, no message.
- Run `deliverBatch` twice, run the processor twice, kill-and-resume mid-way (fake budget 0 then full) → still exactly N messages.
- Two processors concurrently on one broadcast → N messages, no deadlock, no duplicates.
- Creator blocked after the snapshot → remaining SKIPPED `creator_blocked`.
- Customer without a conversation row → created, message delivered.
- Broadcast text and asset are the ones stored on the broadcast (later gallery changes irrelevant); `conversations.mode` and `response_version` unchanged; no AI event written.
- A customer subscribing after the snapshot gets nothing.

---

### TASK-230: Worker broadcast pipeline, end-to-end test and docs

- `apps/worker/src/broadcast/`: queue name `broadcast` (add `BROADCAST_QUEUE` next to `MEDIA_QUEUE` in `queue/bullmq-queue.ts`), `OutboxDispatcher({handledTypes: ['broadcast.created']})`, outbox loops (dispatch ~1 s, reconcile ~30 s), BullMQ consumer calling `BroadcastProcessor.run(eventId, {budgetMs: 20_000})`: `'done'` → outbox event DONE; `'continue'` → event back to PENDING with `available_at = now`; unexpected error → PENDING with backoff (the existing outbox retry helper), attempt cap → FAILED `fanout_error`.
- Wired from `worker.ts` like media (starts only with Redis; logs one line).
- End-to-end test: `POST /v1/creator/broadcasts` (service) → dispatcher → processor → messages exist, `message.created` events written, a customer's `GET /v1/chats/:id/messages` returns the media message and the signed-URL endpoint opens it; an expired customer's chat has none.
- Docs: `codebase-map.md` (tables, queue, processor), `design-integration.md` (no broadcast label in the customer chat).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/worker/src/broadcast/broadcast.ts` (+ int spec) | wiring |
| MODIFY | `apps/worker/src/queue/bullmq-queue.ts`, `apps/worker/src/worker.ts` | queue + start |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md` | docs |

**Testing:** the end-to-end case; worker restart with the event still PENDING completes it; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
