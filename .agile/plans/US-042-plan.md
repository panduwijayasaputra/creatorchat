# Technical Plan: US-042 — New message and broadcast notifications

## Architecture Overview

Agreed with the user (2026-11-21): **delay + read-cursor check** instead of a presence service.

```
message.created (written by every send: manual, broadcast, welcome, customer)  [exists]
   ─▶ OutboxDispatcher (handledTypes += message.created, minAge 30 s) ─▶ `notifications` queue ─▶ NotificationRouter
        └─ MessageNotificationHandler.resolve:
             recipient = the other party of the conversation
             skip: stale (> 10 min old) / recipient blocked / bot-blocked / preferences off / creator muted
                   / read cursor already covers the message / already covered by an earlier notification
             send: one Telegram message for everything unread since the last one, "Buka Aplikasi" → the conversation
```

- **Debounce without a new store.** The dispatcher only claims `message.created` events whose `created_at` is at least 30 s old (new `minAgeMs` per type). By then a user who has the chat open has advanced the read cursor (US-030 marks read while the thread is visible) → SKIPPED `read`. This is the agreed presence substitute; real presence (Redis heartbeat) is a later option. Brief §9 says "presence still fresh": this is a documented deviation.
- **Coalescing.** `notification_state (conversation_id, user_id, last_notified_seq)`: when the first event of a burst is processed, the delivery covers all unread messages (`seq > max(read cursor, last_notified_seq)`) and bumps `last_notified_seq` to the conversation's current max in the same transaction that creates the delivery row (`afterCreate`). The remaining events of the burst find nothing new → SKIPPED `coalesced`. A retry of an already created delivery (same dedupe key) is never skipped by that state (`ctx.existingDelivery`).
- **Dedupe key** `message:<messageId>:telegram` (one delivery per triggering event); the text is built from the database at send time. Ambiguous Telegram timeouts follow US-013 (retried, flagged, no exactly-once claim).
- **Stale guard.** Events older than 10 minutes when claimed (worker down, old backlog of `PENDING` `message.created` rows created before this story) → SKIPPED `stale`, so deploying never notifies for history.
- **Hidden preview by default.** Customer with `show_content = true` gets the shortened text (≤ 80 code points; media-only → "Foto" / "Video"); everyone else gets the sender's name only. Creators have no setting → always hidden.
- Message copy is not designed: placeholder constants in `BOT_COPY` (gap, reported).

Brief refs: §4, §9, §14, §15, §17. Design refs: `Profile` (defaults), `RequestApproved` (button pattern); copy not designed.

## Authorization & Data Rules

- No HTTP surface. Recipient and text come from the database by message id; the payload is never trusted. Plain text, no `parse_mode`. Chat text never stored in `notification_deliveries`, never logged.
- Recipient is derived from the conversation, never from the payload: sender = customer → recipient = creator's user; sender = creator → recipient = customer.
- Skip rules (recipient side): account BLOCKED; `bot_blocked_at`; for a customer recipient also creator BLOCKED, `messages_enabled = false`, a `creator_mutes` row; read cursor `>= message.seq`. Customers whose access expired still get notifications for messages they can still read (access state does not matter for received messages).
- Deep link: customer `/chats/<conversationId>`, creator `/inbox/<conversationId>` (routes exist; the Mini App re-checks ownership after login: another user's id → the normal not-found / role redirect).
- Preferences/mute tables are written by US-043; this story only reads them.

## Dependencies

- US-044 TASK-218 (runner, router, `buildBotMessage`), US-026/US-029 (`message.created`), US-030 (read cursors), US-031 (realtime flag independent of outbox `status`: confirmed — the notification dispatcher only changes `status`).
- US-039 (broadcast messages) and US-041 (welcome) simply produce more `message.created` events. No new packages / env.

## Risks

- **Chat open but cursor not advanced** (e.g. the user is idle without scrolling) → a notification may still arrive; accepted with the delay approach.
- **Burst split at the 30 s boundary** → two notifications; accepted.
- **First deploy backlog** → the 10-minute stale guard.
- **Reading preference tables before US-043 exists:** the migration (TASK-231) creates them with defaults, so absent rows mean "on / hidden / not muted".

## Tasks

### TASK-231: Migration — notification preferences, mutes, state

`<next>_notification_preferences` (and `schema.prisma`):
- `notification_preferences`: `user_id uuid pk fk RESTRICT`, `messages_enabled boolean not null default true`, `show_content boolean not null default false`, `updated_at timestamptz(3)`.
- `creator_mutes`: `user_id uuid fk`, `creator_id uuid fk`, `created_at`; `PRIMARY KEY (user_id, creator_id)`.
- `notification_state`: `conversation_id uuid fk`, `user_id uuid fk`, `last_notified_seq int not null default 0`, `updated_at`; `PRIMARY KEY (conversation_id, user_id)`.
- Prisma models `NotificationPreference`, `CreatorMute`, `NotificationState` with relations.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/<ts>_notification_preferences/migration.sql` | tables |
| MODIFY | `packages/db/prisma/schema.prisma` | models |

**Testing:** migration applies; FK and PK constraints hold; defaults are on / hidden.

---

### TASK-232: Dispatcher `minAgeMs` and the message notification handler

- `OutboxDispatcher` option `minAgeMs?: Record<string, number>`: the claim query adds `AND (type NOT IN (…delayed…) OR created_at <= now() - minAge)` per delayed type (parameterised, no string concatenation). Existing behaviour unchanged when unset.
- `message-notification-handler.ts`: `MessageNotificationHandler` for `message.created`: load message + conversation + customer + creator + creator user + sender; recipient as above; `STALE_MS = 10 * 60_000` check against `event.created_at`; skip reasons (`stale`, `account_blocked`, `bot_blocked`, `creator_blocked`, `disabled`, `muted`, `read`, `coalesced`); unread = messages from the *other* party with `seq > greatest(read cursor, last_notified_seq)` (skip when 0); text from `BOT_COPY` placeholders: hidden `Pesan baru dari {nama}.`, coalesced `{n} pesan baru dari {nama}.`, preview `{nama}: {pratinjau}`; media-only preview `Foto` / `Video`; `afterCreate(tx)` upserts `notification_state.last_notified_seq = conversation max seq`; `kind = 'chat_message'`.
- `BOT_COPY` gets `newMessage`, `newMessages`, `previewPhoto`, `previewVideo` (placeholders, documented as not designed).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/notifications/outbox-dispatcher.ts` | `minAgeMs` |
| CREATE | `packages/backend-core/src/notifications/message-notification-handler.ts` | handler |
| MODIFY | `packages/backend-core/src/creator-link/bot-copy.ts` | placeholder copy |
| MODIFY | `packages/backend-core/src/notifications/index.ts` | exports |

**Testing (integration, fake sender, controlled clock):**
- Customer reply from creator → one SENT to the customer, hidden preview, path `/chats/<id>`; customer message → SENT to the creator, path `/inbox/<id>`.
- Burst of 3 messages in one window → one SENT ("3 pesan baru…"), the other two SKIPPED `coalesced`; a later message after that → a new notification.
- Read cursor advanced before the job → SKIPPED `read`; `messages_enabled false` → `disabled`; muted → `muted`; creator-recipient is never muted/disabled by customer rows.
- `show_content` true → shortened preview (an 80+ char text is cut; a media-only message shows "Foto"/"Video"); default → no message text anywhere in the sent text, the delivery row, or logs (assert).
- Blocked recipient / bot-blocked / blocked creator → SKIPPED; expired customer still notified for a creator message.
- Event older than 10 min → SKIPPED `stale`; event younger than 30 s is not claimed (dispatcher test).
- Telegram 429 / blocked / ambiguous → US-013 outcomes; retry after a state bump still sends (existingDelivery); duplicate job → one send; the chat message is unaffected by every failure.

---

### TASK-233: Worker wiring, end-to-end test and docs

- `apps/worker/src/notifications.ts`: add the handler to the router; `OutboxDispatcher` options `handledTypes` = router types, `minAgeMs: { 'message.created': 30_000 }` (constant `MESSAGE_NOTIFY_DELAY_MS`, overridable in tests).
- End-to-end: a real `message.created` from `CreatorChatService.send` → after the delay (fake clock) → one Telegram call; the realtime publisher still emits its socket signal independently (`realtime_published_at` set, `status` untouched by realtime).
- Docs: `codebase-map.md`, `design-integration.md` Known Gaps (bot message copy, presence substitute), brief deviation noted in `tech-stack.md` decisions log.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/worker/src/notifications.ts`, `pipeline.int.spec.ts` | wiring + e2e |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md`, `tech-stack.md` | docs |

**Testing:** the e2e case; `realtime.int.spec.ts` unchanged; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
