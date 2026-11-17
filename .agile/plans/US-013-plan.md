# Technical Plan: US-013 — Bot sends the creator request result

## Architecture Overview

Agreed with the user (2026-11-16, all three recommended options):

1. **The worker polls the outbox.** US-012 writes `outbox_events` rows in the decision transaction. A worker loop claims `PENDING` rows every ~1 s (`FOR UPDATE SKIP LOCKED`, only the event types it has a processor for), adds a BullMQ job per row (job id = the event id) and marks the row `ENQUEUED`. A slower reconciler puts stale `ENQUEUED` rows back to `PENDING`. The API never talks to a queue.
2. **Ambiguous sends are retried and flagged.** A timeout, a network error or a crash while sending is recorded as *ambiguous* on the delivery row and retried with backoff up to the attempt cap (at-least-once). Rarely the user could get the message twice; nobody is left without their result, and nothing claims exactly-once.
3. **Bot-blocked is a user flag cleared by `/start`.** A 403 sets `users.bot_blocked_at`; later notifications to that user skip Telegram. The existing webhook clears the flag when that user sends `/start` again (a guarded DB write that can never break the reply).

How it works end to end:

```
admin decision tx ──writes──▶ outbox_events (PENDING)           [US-012]
worker OutboxDispatcher (poll ~1 s) ──▶ BullMQ job (jobId = event id), row ENQUEUED
BullMQ processor ──▶ CreatorResultNotifier
    claim delivery row (unique dedupe key) ──▶ TelegramSender.sendMessage ──▶ record outcome
    SENT / BOT_BLOCKED / SKIPPED / FAILED  ⇒ outbox DONE or FAILED
    429 / 5xx / network / ambiguous        ⇒ outbox back to PENDING with available_at = now + backoff
OutboxReconciler (every ~30 s) ──▶ stale ENQUEUED → PENDING, stale SENDING → ambiguous retry
```

- **Retries live in PostgreSQL, not in BullMQ.** The job always completes; the business outcome is in the DB (`notification_deliveries`, `outbox_events`). Queue success is never taken as delivery success, and a lost Redis job only delays the message until the reconciler re-queues it.
- **Business state is separate.** The approval or rejection is never touched; a failed notification changes nothing about it.
- **No UI in this story.** The Telegram message is the product. `RequestApproved` is the board for the approved message (its DEMO strip is not built); the rejection message is not designed (placeholder copy).

Brief refs: §5, §9 (notification failure does not undo the business change; `retry_after`/backoff; bot-blocked marked without infinite retry; no exactly-once claim on ambiguous timeouts), §13 (`OutboxEvent`, `NotificationDelivery`), §14 (outbox bridges commit → queue; idempotent worker). Design refs: `RequestApproved` (message text and the "Buka Aplikasi" button).

Out of scope (Phase E): notification preferences, per-creator mute, hidden-preview option, coalescing bursts, presence checks. The result message carries no chat content, so none of those apply here.

## Authorization & Data Rules

- **No HTTP surface** and no caller-supplied id. The worker is the only actor. The chat id is `users.telegram_id` of the application's user, **loaded by id from the DB**; the outbox payload carries ids only and is never trusted for the recipient or the text.
- **Message content is read at send time** from the application row (the admin's reason), sent as **plain text** (no `parse_mode`), so nothing in a reason can be interpreted as markup. The reason is not stored in the outbox or the delivery row.
- **Idempotency (three layers):** `outbox_events.dedupe_key` (US-012); BullMQ job id = the event id; `notification_deliveries.dedupe_key` UNIQUE (`creator_application:<id>:decision:telegram`). A duplicate job finds a terminal delivery and finishes without sending.
- **Claim before send:** the delivery moves `PENDING → SENDING` with a single conditional `UPDATE … WHERE status = 'PENDING'` (returns a row only for one worker). A row left in `SENDING` past a timeout is treated as an ambiguous attempt (the worker may have crashed after Telegram accepted it).
- **Outcome mapping:**
  | Telegram result | Delivery | Outbox event |
  |---|---|---|
  | ok (`message_id`) | `SENT` | `DONE` |
  | 403 (bot blocked / user deactivated) | `BOT_BLOCKED`, `users.bot_blocked_at = now` | `DONE` |
  | 429 | `PENDING` (attempt counted) | `PENDING`, `available_at = now + retry_after` (clamped 1 s – 1 h) |
  | 5xx, network error, timeout (**ambiguous**) | `PENDING`, `ambiguous_attempts + 1` | `PENDING`, backoff 5 s, 30 s, 2 min, 10 min, 30 min, 1 h, 2 h |
  | other 4xx (e.g. chat not found, bad request) | `FAILED` | `FAILED` |
  | attempt cap (10) reached | `FAILED` | `FAILED` |
- **Skipped without calling Telegram** (`SKIPPED`, event `DONE`, reason recorded as a short code): the account is `BLOCKED`, or `bot_blocked_at` is set, or the user no longer exists. A blocked account cannot use the app the message points to.
- **Decision check:** the event type says approved/rejected; the worker confirms the application is in that status (a mismatch → `FAILED`, never a wrong message). The approved message is only sent for an APPROVED application.
- **Unconfigured bot** (no token / Mini App URL): the dispatcher claims nothing; events stay `PENDING`; one warning is logged per start. Sending begins when the worker restarts with config.
- **Logging:** only event id, delivery id, outcome and error class/code. Never the bot token, the chat id's message text, a reason, `initData` or a raw Telegram error message (which can echo a URL containing the token). Tests assert the token never appears in logs or rows.
- **Events emitted** are rows, not sockets: this story adds no socket event.

## Dependencies

- **BullMQ 6.5.4** — chosen over the newest (6.7.6, 4 days old) because it is about two weeks old; peer range `ioredis >= 5` accepts the repo's ioredis 6.0.0; Redis 8.10 locally (BullMQ needs Redis >= 5). Worker connections for BullMQ use `maxRetriesPerRequest: null` (blocking commands); the existing health-probe connection keeps its own options. Queue prefix `bull` in dev, `test:bull:<random>` in tests so they never touch dev queues.
- **grammY 1.46.0** in `apps/worker` too (same pin as the API; outbound `Api` only, `client.timeoutSeconds: 15`, the Bot API root is a constructor parameter, never an env var).
- Both versions are recorded in the decisions log and the "Pinned Versions" table; the lockfile is committed.
- Env: none new. The worker already loads `TELEGRAM_BOT_TOKEN` and `MINIAPP_URL` from the shared server env.
- Prior stories: US-012 (outbox events, `CreatorApprovalService`), US-005 (bot, `buildStartReply`, `BOT_COPY`), US-001 (worker shell).

## Risks

- **Duplicate message after an ambiguous send** (accepted): flagged by `ambiguous_attempts` on the delivery row; no exactly-once claim anywhere.
- **Redis flushed / job lost:** the reconciler re-queues `ENQUEUED` rows older than 2 min; the BullMQ job id deduplicates while a job still exists; the delivery claim makes a double run harmless.
- **Crash between enqueue and marking `ENQUEUED`:** the row stays `PENDING` and is enqueued again (same job id, same delivery key).
- **Crash after Telegram accepted but before recording:** the delivery is `SENDING`; the reconciler treats it as ambiguous and retries (possible duplicate, flagged).
- **A 429 storm or Telegram outage:** backoff and `retry_after` are in the DB, so a restart loses nothing; the cap marks the event `FAILED` instead of looping forever.
- **Token leakage through errors:** only error class names and numeric codes are ever recorded or logged; covered by a test with an error whose message contains the token.
- **`ALTER TYPE … ADD VALUE`** (new outbox statuses) cannot be used in the transaction that adds it: the migration only adds them; nothing in it uses them.
- **The webhook gains a DB write:** guarded, ignores failures and never delays the reply beyond one fast update.
- **Real Telegram is untested here:** the adapter is tested against a fake Bot API server and the logic against a fake sender; sending to a real chat is a manual check with a dev bot.

## Tasks

### TASK-076: Notification schema and message copy

- **Migration** (new folder with the next `2026112…` prefix, SQL checked in; Prisma's own diff, like US-012):
  - `OutboxEventStatus` gains `ENQUEUED` and `FAILED`; `outbox_events` gains `enqueued_at timestamptz(3) null` and `last_error text null` (a short code such as `decision_mismatch`, never free text).
  - New enum `NotificationStatus { PENDING, SENDING, SENT, BOT_BLOCKED, FAILED, SKIPPED }` and table `notification_deliveries`: `id uuid pk`, `dedupe_key text UNIQUE`, `outbox_event_id uuid` (FK, RESTRICT), `user_id uuid` (FK, RESTRICT), `kind text`, `status NotificationStatus default PENDING`, `attempts int default 0`, `ambiguous_attempts int default 0`, `telegram_message_id bigint null`, `last_error_code text null`, `claimed_at timestamptz(3) null`, `sent_at timestamptz(3) null`, `created_at`, `updated_at`; index `(status, claimed_at)`.
  - `users.bot_blocked_at timestamptz(3) null`.
  - `resetDatabase` / identity-baseline scope test list the new table.
- **Pure message builders** in `packages/backend-core/src/notifications/creator-result-message.ts`: `buildCreatorResultMessage({ decision: 'approved' | 'rejected', reason?: string | null, miniAppUrl })` → `{ text, buttonText, url }`.
  - Approved: text verbatim from `RequestApproved`: "Selamat, permintaanmu disetujui. Akunmu sekarang akun creator. Buka aplikasi untuk masuk ke Inbox."
  - Rejected (**design gap, placeholder**): "Permintaanmu menjadi creator belum bisa disetujui.\n\nAlasan dari admin: <reason>\n\nKamu bisa memperbaiki isian lalu mengajukan lagi."
  - Button text "Buka Aplikasi" (`BOT_COPY.menuButton`), URL = the Mini App origin + `/` via `buildStartReply` (no destination: the app lands the account by role). Copy constants added to `bot-copy.ts` with the gap noted. Returns `null` when the Mini App URL is unset or malformed.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/<next>_notification_deliveries/migration.sql` | enums, table, columns |
| MODIFY | `packages/db/prisma/schema.prisma` | `NotificationDelivery`, enums, `OutboxEvent` and `User` fields |
| MODIFY | `packages/db/src/testing/test-db.ts`, `packages/db/test/identity-baseline.int.spec.ts` | reset list and scope list |
| MODIFY | `packages/backend-core/src/creator-link/bot-copy.ts` | result-message copy (placeholder noted) |
| CREATE | `packages/backend-core/src/notifications/creator-result-message.ts`, `.spec.ts`, `index.ts` | pure builders |
| MODIFY | `packages/backend-core/src/index.ts` | export |

**Testing:** the migration applies on a database that already has events and users (defaults hold); the approved text is exactly the board's; the rejected message contains the reason verbatim and no markup handling is needed (plain text); an HTML-looking reason stays literal; the URL origin is always the configured origin and a malformed URL gives `null`; `dedupe_key` is UNIQUE and the FK refuses an unknown user or event.

---

### TASK-077: Outbox dispatcher and reconciler

`packages/backend-core/src/notifications/` (framework-light, injected clock and queue port):

```ts
interface JobQueue { add(job: { jobId: string; name: string; data: { eventId: string } }): Promise<void>; }
class OutboxDispatcher {
  constructor(prisma, queue: JobQueue, opts: { handledTypes: readonly string[]; batchSize?: number; clock?: () => Date; staleEnqueuedMs?: number; staleSendingMs?: number })
  dispatch(): Promise<{ enqueued: number }>      // claim PENDING & available_at <= now, enqueue, mark ENQUEUED
  reconcile(): Promise<{ requeued: number; ambiguous: number }>  // stale ENQUEUED -> PENDING; stale SENDING deliveries -> ambiguous retry
}
```
- `dispatch`: in one transaction `SELECT … WHERE status = 'PENDING' AND available_at <= $now AND type = ANY($handled) ORDER BY available_at, created_at LIMIT $batch FOR UPDATE SKIP LOCKED`; enqueue each (job id = event id, job name = event type) **before** marking `ENQUEUED` (`enqueued_at = now`), so a crash leaves a re-enqueueable `PENDING` row. A queue failure leaves the row `PENDING` and is reported, not thrown past the batch.
- `reconcile`: `ENQUEUED` older than `staleEnqueuedMs` (default 2 min) → `PENDING`; deliveries `SENDING` with `claimed_at` older than `staleSendingMs` (default 2 min) → back to `PENDING` with `ambiguous_attempts + 1`, their event `PENDING` with a backoff `available_at`. Only events of handled types.
- Pure `backoffMs(attempt)` (5 s, 30 s, 2 min, 10 min, 30 min, 1 h, 2 h, then 2 h) and `MAX_ATTEMPTS = 10` live next to it.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/notifications/outbox-dispatcher.ts`, `outbox-dispatcher.int.spec.ts`, `backoff.ts`, `backoff.spec.ts`, `job-queue.ts` | dispatcher, reconciler, port |
| MODIFY | `packages/backend-core/src/notifications/index.ts` | export |

**Testing (integration, real PostgreSQL, in-memory queue):** a committed `PENDING` event is enqueued once with job id = event id and becomes `ENQUEUED`; an event whose `available_at` is in the future is not claimed; unhandled types are never claimed; two dispatchers racing over the same rows enqueue each event exactly once (`SKIP LOCKED`); a queue failure leaves the row `PENDING`; **reconciler pick-up after a simulated crash** (row `ENQUEUED` for 5 min with no job → `PENDING` → enqueued again); a fresh `ENQUEUED` row is left alone; a stale `SENDING` delivery becomes an ambiguous retry; `DONE`/`FAILED` rows are never touched; `backoffMs` schedule and cap.

---

### TASK-078: `CreatorResultNotifier` and the Telegram sender port

```ts
type SendOutcome =
  | { kind: 'ok'; messageId: number }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'blocked' }                 // 403
  | { kind: 'permanent'; code: string } // other 4xx
  | { kind: 'transient'; code: string } // 5xx
  | { kind: 'ambiguous'; code: string };// timeout / network: may or may not have been delivered
interface TelegramSender { sendMessage(chatId: bigint, message: { text: string; buttonText: string; url: string }): Promise<SendOutcome>; }

class CreatorResultNotifier {
  constructor(prisma, sender: TelegramSender, opts: { miniAppUrl: string | undefined; clock?: () => Date })
  process(eventId: string): Promise<'sent' | 'blocked' | 'skipped' | 'retry' | 'failed' | 'duplicate' | 'missing'>
}
```
- `process` follows the outcome table in "Authorization & Data Rules": load event (must be a handled type and not `DONE`/`FAILED`), load the application and its user by id, check status and eligibility, insert the delivery with `ON CONFLICT (dedupe_key) DO NOTHING`, **claim** it (`PENDING → SENDING`, `attempts + 1`, `claimed_at`), build the message, call the sender **outside any DB transaction**, then record the outcome and move the event (`DONE` / `FAILED` / `PENDING` + `available_at`) in one short transaction. A delivery already `SENT` / `BOT_BLOCKED` / `SKIPPED` / `FAILED` → `duplicate`: the event is marked `DONE` (or left `FAILED`) and nothing is sent.
- The approval/rejection rows and the user's role are never written. Errors from the sender port are classified there; this service only sees `SendOutcome`. Nothing it logs or stores contains the token, the text or a Telegram error message.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/notifications/creator-result-notifier.ts`, `creator-result-notifier.int.spec.ts`, `telegram-sender.ts` | service, port and outcome types |
| MODIFY | `packages/backend-core/src/notifications/index.ts` | export |

**Testing (integration, fake sender):** **one message per decision** for both approved and rejected (chat id = the user's Telegram id, button and URL as built, reason verbatim for rejected); a **duplicate job** (processed twice, and two workers at once) sends exactly once; **429 then success** (first call → event `PENDING` with `available_at ≈ now + retry_after`, second → `SENT`, one sent message, attempts 2); **403** → `BOT_BLOCKED`, `bot_blocked_at` set, event `DONE`, no retry, and the next notification to that user is `SKIPPED` without a send; other 4xx → `FAILED`; 5xx and **ambiguous** → backoff and retry with `ambiguous_attempts` counted, success on a later attempt, and `FAILED` at the cap; a `BLOCKED` account and a vanished user → `SKIPPED`; a decision/status mismatch → `FAILED` with no send; the sender throwing an error whose message holds the bot token leaves the token out of every row and log; the approval and role are untouched in every path (a failed notification never rolls anything back); the sender is never called inside an open transaction.

---

### TASK-079: Worker wiring (BullMQ, grammY sender, loops)

`apps/worker` (add `bullmq@6.5.4` and `grammy@1.46.0`, exact pins, lockfile committed; record both in `tech-stack.md`):

- `src/queue/bullmq-queue.ts`: `createNotificationQueue({ redisUrl, prefix })` → a `JobQueue` adapter over a BullMQ `Queue` named `notifications` (`jobId` = event id, `removeOnComplete` after a short age, `removeOnFail` kept briefly) and a `createNotificationWorker({ …, handler })` over a BullMQ `Worker` (concurrency 5, `maxRetriesPerRequest: null` connection, prefix `bull` / test prefix). The handler calls `notifier.process(eventId)`; it **always completes the job** (retries are in the DB). A handler crash is logged by class name only.
- `src/telegram/grammy-sender.ts`: `createGrammySender({ token, apiRoot? })` implements `TelegramSender` with grammY's `Api` (`client.timeoutSeconds: 15`, optional `apiRoot` as a parameter). `sendMessage(chatId, { text, buttonText, url })` sends **plain text** with a one-button `web_app` inline keyboard. Classification: `GrammyError` 429 → `rate_limited` (`parameters.retry_after`), 403 → `blocked`, other 4xx → `permanent`, 5xx → `transient`, `HttpError` and timeouts → `ambiguous`. Error messages and the cause are never copied into the outcome (only a short code such as `http_400`).
- `src/outbox/loops.ts`: `startOutboxLoops({ dispatcher, intervalMs: 1000, reconcileMs: 30_000, logger })` with overlap protection (a slow tick is not re-entered), error counting that logs only on state changes, and a `stop()` that waits for the running tick.
- `src/main.ts` / `worker.ts`: build the dispatcher, notifier, queue, BullMQ worker and sender when `TELEGRAM_BOT_TOKEN` and `MINIAPP_URL` are set; otherwise log once that notifications are unconfigured and register nothing. Graceful shutdown order: stop loops → close the BullMQ worker (drain) → close the queue → Redis → Prisma. The existing health probe is unchanged.
- Docs: README (run the worker, what it needs, "events wait until the bot is configured") and `CONFIGURATION.md` (the bot token is also read by the worker).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/worker/package.json`, `pnpm-lock.yaml` | `bullmq@6.5.4`, `grammy@1.46.0` |
| CREATE | `apps/worker/src/queue/bullmq-queue.ts`, `bullmq-queue.int.spec.ts` | queue + worker adapter |
| CREATE | `apps/worker/src/telegram/grammy-sender.ts`, `grammy-sender.spec.ts` | sender and error classification |
| CREATE | `apps/worker/src/outbox/loops.ts`, `loops.spec.ts` | polling loops |
| CREATE | `apps/worker/src/pipeline.int.spec.ts` | end-to-end pipeline test |
| MODIFY | `apps/worker/src/main.ts`, `worker.ts`, `worker.spec.ts` | wiring and shutdown |
| MODIFY | `README.md`, `CONFIGURATION.md` | worker notes |

**Testing:**
- *Sender* against a **fake Bot API HTTP server** (no real Telegram): a 200 returns the message id and the request carries the chat id, plain text, no `parse_mode`, and a `web_app` button on the Mini App origin; 429 with `retry_after`; 403; 400; 500; a hung response hits the timeout and is `ambiguous`; an error whose text contains the bot token produces an outcome without it.
- *Queue adapter* with real Redis and a random test prefix: a job is processed once; the same job id added twice runs once; the handler throwing does not retry-loop; the queue closes cleanly.
- *Loops*: no overlap of a slow tick, errors do not stop the loop, `stop()` waits.
- ***Pipeline*** (real PostgreSQL + Redis, fake sender): approve a request through `CreatorApprovalService` → the loops move the event → exactly one fake message is sent → the event is `DONE` and the delivery `SENT`; a rejection sends the placeholder with the reason; killing the loops between enqueue and send (simulated) and starting again still sends once; 429 then success through the real loops with a short clock; the approval and role are unchanged after a failed send.
- *Worker shell*: unconfigured bot registers nothing and logs once; configured starts and stops cleanly; the token never appears in logs.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.

---

### TASK-080: `/start` clears the bot-blocked flag

`apps/api/src/modules/telegram-webhook/`: the `/start` handler (private chats only) calls an injected `onStart(telegramId)`; the module provides it as a guarded `UPDATE users SET bot_blocked_at = NULL WHERE telegram_id = $1 AND bot_blocked_at IS NOT NULL`. A failure is swallowed (logged by class name) and the reply still goes out; no user is created and nothing else changes. `ctx.from.id` is the only input; the webhook secret check and `canUseWebhookReply` behaviour stay as they are.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/telegram-webhook/telegram-bot.factory.ts`, `telegram-webhook.module.ts` (and the controller if it wires the factory) | `onStart` seam and provider |
| CREATE | `apps/api/test/telegram-bot-unblock.int.spec.ts` | integration test |
| MODIFY | `apps/api/test/telegram-webhook.spec.ts` | keep the existing replies unchanged |

**Testing:** a blocked user sending `/start` gets their flag cleared and still receives the normal reply; other users' flags are untouched; `/start` in a group, any other command and an update with no sender clear nothing; a database failure still answers the webhook with the reply; the webhook secret rules are unchanged (wrong secret → 401, nothing cleared); the next notification to a cleared user is sent again (covered with the notifier in the pipeline test).

---

## Implementation order

TASK-076 → TASK-077 → TASK-078 → TASK-079 → TASK-080 (rebuild `db` and `backend-core` before the worker and API see them; `pnpm install` for the two new worker dependencies).

## Open inputs

- **Rejected-request message copy** is undesigned: placeholder text that includes the admin's reason (one constant in `bot-copy.ts`).
- Real Telegram is not exercised by tests; send to a real chat only with a dev bot (`TELEGRAM_BOT_TOKEN` in `.env`) after `pnpm dev` and an approval.
- Notification log screens (`AdmLogNotif*`, retry dialog) are Phase G; this story only writes the rows they will read.
- At story completion (dev-team): `codebase-map.md` (entities `NotificationDelivery`, outbox statuses, `users.bot_blocked_at`, queue `notifications`, worker processors, inventory), `tech-stack.md` decisions (dispatch by polling, retries in the DB, ambiguous policy, bot-blocked flag, BullMQ and grammY pins), QA reports.
