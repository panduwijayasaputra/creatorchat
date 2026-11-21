# Technical Plan: US-041 — Welcome message delivered once to each new subscriber

## Architecture Overview

Agreed with the user (2026-11-21). A separate outbox event, not a second consumer of `subscription.granted`.

```
SubscriptionAccessService.grant — tx: the grant CREATED the subscription row (no earlier subscription for the pair)
   └─ outbox  welcome.requested  {subscription_id, customer_id, creator_id}   dedupe: welcome:<creatorId>:<customerId>
worker OutboxDispatcher(handledTypes: welcome.requested) ─▶ BullMQ `welcome` queue ─▶ WelcomeDeliveryService.deliver(eventId)
   └─ tx: lock conversation → re-check → welcome_deliveries insert → writeCreatorMessage (US-039 TASK-228) → link message
```

- **Why a separate event.** `subscription.granted` already feeds the access notification (US-044) through one dispatcher/queue with one status per event; two consumers of one outbox row would couple their retries. A second event written in the same grant transaction keeps each pipeline independent, and "first access" is decided atomically where the fact is known: the grant created the `subscriptions` row. Extend, re-grant after expiry or revoke, and renewals update the existing row and write no welcome event.
- **Switch is read at delivery**, not at grant. If it is off then (or the row is missing), the event completes as SKIPPED `disabled` and nothing is sent later; turning it on afterwards does not retroactively greet earlier subscribers (documented decision).
- **At-most-once:** `welcome_deliveries PRIMARY KEY (creator_id, customer_id)` (insert first; a conflict means already handled) + deterministic `client_message_id = welcome_deliveries.id` + the existing message unique constraint.
- **Looks like any creator message:** `origin MANUAL`, no label, no `broadcast_id`; `conversations.mode` / `response_version` untouched; no AI event.
- The message produces the normal `message.created` event → realtime and (after 30 s, if still unread) a Telegram notification via US-042.

Brief refs: §6, §14; design-integration Resolved Conflict #5. Design refs: `CrWelcome` (preview), `Chat`.

## Authorization & Data Rules

- No HTTP surface. Text and media are read from `creator_welcome_messages` **at delivery time** by creator id from the subscription row; the payload is ids only.
- In the delivery transaction, after locking the conversation: entitlement active now (`starts_at <= now < ends_at`, not revoked), customer ACTIVE, creator ACTIVE, creator user ACTIVE, welcome `enabled` with text → else SKIPPED with a reason code (`disabled`, `access_ended`, `customer_blocked`, `creator_blocked`), event DONE, no message.
- The welcome asset (if any) must still be READY; a missing/failed asset → the message is sent with the text only (the text is the product; logged as `asset_unavailable`).
- Conversation created idempotently if missing (`ON CONFLICT (customer_id, creator_id) DO NOTHING`).
- Locks: `welcome_deliveries` row (insert) then conversation, as in broadcast.
- Logs: ids and outcome codes only.

## Dependencies

- US-040 (config table, assets), US-039 TASK-228 (`writeCreatorMessage`), US-020 / US-024 (grant path — approvals go through `SubscriptionAccessService.grant`), US-013 (dispatcher pattern), the `media` / `broadcast` worker pipelines as templates. No new packages / env.

## Risks

- **Grant transaction change:** adding an outbox write to `grant` must not alter US-020/US-024 behaviour → their integration suites run unchanged first.
- **Welcome plus "Akses diaktifkan" plus (later) a message notice** reach the customer in quick succession. Accepted; the message notice is skipped when the customer already read the chat.
- **Existing subscriptions** (seed or earlier grants) never get a welcome message: only grants after this story ships create the event.

## Tasks

### TASK-245: Migration and first-grant event

- `<next>_welcome_deliveries` and `schema.prisma`: `welcome_deliveries`: `id uuid default gen_random_uuid()` (unique), `creator_id uuid fk`, `customer_id uuid fk`, `message_id uuid null unique fk RESTRICT`, `created_at timestamptz(3)`, `PRIMARY KEY (creator_id, customer_id)`.
- `OutboxEventType.WELCOME_REQUESTED: 'welcome.requested'`.
- `SubscriptionAccessService.grant`: when the statement created a new `subscriptions` row (not an update of an existing one), `outbox.add(tx, {type: WELCOME_REQUESTED, aggregateType: 'subscription', aggregateId: row.id, payload: {subscription_id, customer_id, creator_id}, dedupeKey: 'welcome:<creator_id>:<customer_id>'})` in the same transaction.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/<ts>_welcome_deliveries/migration.sql` | table |
| MODIFY | `packages/db/prisma/schema.prisma` | model |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | event type |
| MODIFY | `packages/backend-core/src/subscription-access/subscription-access.service.ts` (+ int spec) | first-grant event |

**Testing (integration):** first grant (also via an approved access request) writes `welcome.requested`; extend, revoke, re-grant after expiry or revoke write none; two concurrent first grants write one (dedupe + row uniqueness); a rolled-back grant writes none; existing US-020/US-024 suites unchanged.

---

### TASK-246: `WelcomeDeliveryService`

`packages/backend-core/src/welcome-message/welcome-delivery.service.ts`: `deliver(eventId): Promise<'delivered' | 'skipped' | 'duplicate' | 'missing'>` — load event (type check, ids from the subscription row, not the payload), one transaction as designed (conversation upsert + lock → re-checks → `INSERT INTO welcome_deliveries … ON CONFLICT DO NOTHING RETURNING id` (no row → `duplicate`) → `writeCreatorMessage({clientMessageId: delivery.id, body, assetId})` → `UPDATE welcome_deliveries SET message_id`) and the outbox event closed DONE (SKIPPED reasons are recorded in `outbox_events.last_error` as a short code). Transient database error → rethrown so the processor retries with backoff; a crash after commit is safe (the delivery row exists).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/welcome-message/welcome-delivery.service.ts` (+ int spec) | delivery |
| MODIFY | `packages/backend-core/src/welcome-message/index.ts`, `src/index.ts` | exports |

**Testing (integration):**
- Enabled text-only welcome → one creator message in the new conversation, `origin MANUAL`, no `broadcast_id`; with gallery asset → attachment on the same asset (no new object, no new gallery item); with WELCOME upload → attachment, asset in no gallery.
- Switch off / no config → SKIPPED, no message; access expired or revoked before delivery, customer or creator blocked → SKIPPED.
- Duplicate event, job retry, two concurrent deliveries, crash simulated after the message commit → exactly one message and one `welcome_deliveries` row.
- Welcome text edited after the grant but before delivery → the new text is sent; after delivery → the message is unchanged.
- `conversations.mode`, `response_version` unchanged; no AI event written; `message.created` outbox event written.
- Failed/missing asset → text-only message.

---

### TASK-247: Worker welcome pipeline, end-to-end test and docs

- `apps/worker/src/welcome/welcome.ts`: queue `welcome` (`WELCOME_QUEUE` in `queue/bullmq-queue.ts`), `OutboxDispatcher({handledTypes: ['welcome.requested']})`, outbox loops, consumer → `WelcomeDeliveryService.deliver`; transient error → event PENDING with backoff, cap → FAILED `welcome_error`. Started from `worker.ts` next to media / broadcast.
- End-to-end: admin grant → `welcome.requested` → welcome message in the customer's chat (history endpoint returns it, media opens through the US-037 URL endpoint) and `subscription.granted` → access notification (US-044) both happen independently; an extend afterwards adds no welcome message.
- Docs: `codebase-map.md` (tables, event, queue, service), `design-integration.md` (decision: switch read at delivery, no retroactive welcome).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/worker/src/welcome/welcome.ts` (+ int spec) | wiring |
| MODIFY | `apps/worker/src/queue/bullmq-queue.ts`, `worker.ts` | queue + start |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md` | docs |

**Testing:** the end-to-end cases; worker restart with the event pending completes it; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
