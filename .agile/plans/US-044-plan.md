# Technical Plan: US-044 — Access activated notification

## Architecture Overview

Agreed with the user (2026-11-21, Phase E planning). First Phase E slice: it introduces the **shared Telegram delivery runner** that US-042 and US-045 reuse.

```
SubscriptionAccessService (grant / extend, US-020/US-024)
   └─ tx: subscription_event + outbox  subscription.granted | subscription.extended   [exists]
worker OutboxDispatcher (handledTypes += both) ─▶ BullMQ `notifications` ─▶ NotificationRouter
   └─ AccessActivatedHandler.resolve(event) ─▶ TelegramDeliveryRunner (claim → send → record)   [US-013 core, extracted]
```

- **Extract, don't copy.** `CreatorResultNotifier` today mixes event loading, the claim/send/record state machine and the creator-result rules. TASK-218 moves the state machine (delivery row, claim, outcome mapping, backoff, bot-blocked flag) into `TelegramDeliveryRunner` and turns creator-result into the first *handler*. Behaviour and the existing `creator-result-notifier.int.spec.ts` stay identical (the class keeps its public `process(eventId)`).
- **Handler contract** (`NotificationHandler`): `types: readonly string[]`; `resolve(event, ctx): Promise<Resolution>` where `Resolution` = `{kind:'send', userId, kind: string, dedupeKey, message: BotMessage, afterCreate?(tx)}` | `{kind:'skip', userId?, kind, dedupeKey, reason}` | `{kind:'fail', code}`. `ctx` carries `now`, `miniAppUrl`, and `existingDelivery` (so a retry of an already-claimed delivery is never skipped by state that the first attempt changed). The runner creates the delivery row (+ `afterCreate` in the same transaction), applies the common skip rules (account BLOCKED, `bot_blocked_at`), claims, sends, records.
- **`NotificationRouter`** maps event type → handler; the BullMQ processor calls `router.process(eventId)`. One dispatcher with the union of handled types serves all notification kinds.
- **Deep link** = `web_app` button URL on the Mini App origin plus a path (`/chats/<conversationId>` or `/subscriptions`). `BotMessage.url` stays "always on the configured origin"; a `buildBotMessage({text, miniAppUrl, path})` helper validates `path` against `^/[A-Za-z0-9/_-]{0,80}$`. The Mini App re-checks everything after login (existing chat 404 rules).
- **Templates**: the three `AdmSetNotif` default texts live in one module (`access-templates.ts`) so Phase G can later make them editable; rendering replaces only `{nama}`, `{creator}`, `{tanggal}`.

Brief refs: §6, §9 (access activation notification; failure never touches the business change; `retry_after`, bot-blocked), §11 (template notifikasi), §14. Design refs: `AdmSetNotif` (template), `AdmDlgGrant` / extend dialog (promise), `RequestApproved` (button pattern).

## Authorization & Data Rules

- No HTTP surface. Recipient, creator name, date and conversation are **loaded by id from the database**; the outbox payload (ids, `ends_at`) is never trusted for text or recipient.
- Message text is plain (no `parse_mode`): the creator display name and customer name can contain any characters.
- `{tanggal}` = the event's `new_ends_at` (from `subscription_events`, found by `payload.event_id` and verified to belong to `aggregate_id`), formatted in the **customer's** `users.timezone` as `27 Nov 2026, 23.59 WIB` (WIB / WITA / WIT for the three Indonesian zones, `UTC+n` otherwise).
- Dedupe key `subscription_event:<eventId>:telegram` (unique on `notification_deliveries`); BullMQ job id = outbox event id (existing).
- SKIPPED (no Telegram call, outbox DONE, short reason code): subscription revoked, `ends_at <= now`, customer or creator BLOCKED, creator user BLOCKED, customer `bot_blocked_at`. Missing event/subscription → FAILED `event_missing`.
- Not filtered by message-notification preferences or mute (those only govern chat messages, US-043).
- A failed send never touches the subscription; the FAILED delivery row waits for Phase G's admin retry.
- Logs: event id, delivery id, outcome, error class only.

## Dependencies

- US-013 (delivery table, dispatcher, backoff, grammY sender), US-020 / US-024 (events), US-009 (`users.timezone`). No new packages, no env.

## Risks

- **Refactor regression of US-013** → keep `CreatorResultNotifier.process` and run its integration spec unchanged before adding handlers.
- **Short grants** (e.g. 1 day) are fine: the notice states the end date and time.
- **Event ordering**: grant followed at once by extend sends two notices (each with its own end date). Accepted.

## Tasks

### TASK-218: Shared Telegram delivery runner and router

Refactor `packages/backend-core/src/notifications`:
- `delivery-runner.ts`: `TelegramDeliveryRunner` (constructor `(prisma, sender, {miniAppUrl, clock})`) with `run(event, handler): Promise<NotifyResult>` — the logic currently inside `CreatorResultNotifier.process` after the application lookup: create the delivery row with `skipDuplicates` (and run `resolution.afterCreate(tx)` in the same transaction as the insert), existing-delivery short circuits (`SENDING` → duplicate; terminal → close event), account/bot-blocked SKIPPED, claim (`PENDING → SENDING`), send outside any transaction, `record(...)` with the same outcome table, `finishEvent`, `retryEvent`. Types move with it (`NotifyResult`).
- `handler.ts`: `NotificationHandler`, `Resolution`, `ResolveContext` as described above.
- `message-builder.ts`: `buildBotMessage({text, buttonText?, miniAppUrl, path?})` (returns `null` for a missing/malformed URL or a path that fails the regex); `buildCreatorResultMessage` calls it.
- `creator-result-notifier.ts`: becomes `CreatorResultHandler` (the application lookup + decision check) plus a thin `CreatorResultNotifier` wrapper kept for compatibility (`process(eventId)` loads the event, runs the runner).
- `notification-router.ts`: `NotificationRouter(prisma, runner, handlers[])`, `handledTypes`, `process(eventId)` (unknown type → `'missing'`).
- Export everything from `notifications/index.ts`; `CREATOR_RESULT_EVENT_TYPES` stays exported.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/notifications/delivery-runner.ts` | claim → send → record state machine |
| CREATE | `packages/backend-core/src/notifications/handler.ts` | handler contract |
| CREATE | `packages/backend-core/src/notifications/message-builder.ts` | `buildBotMessage` with validated path |
| CREATE | `packages/backend-core/src/notifications/notification-router.ts` | type → handler |
| MODIFY | `packages/backend-core/src/notifications/creator-result-notifier.ts` | handler + compatibility wrapper |
| MODIFY | `packages/backend-core/src/notifications/creator-result-message.ts` | use `buildBotMessage` |
| MODIFY | `packages/backend-core/src/notifications/index.ts` | exports |

**Testing:**
- Existing `creator-result-notifier.int.spec.ts`, `outbox-dispatcher.int.spec.ts`, `backoff.spec.ts` pass unchanged.
- `delivery-runner.int.spec.ts` with a stub handler: send → SENT; 429 → PENDING + `available_at`; blocked → BOT_BLOCKED + flag; ambiguous → counted; cap → FAILED; duplicate job sends once; `afterCreate` runs once and rolls back with the insert.
- `message-builder.spec.ts`: path regex (rejects `//evil.com`, `..`, query/fragment, over-long), origin always the configured one.

---

### TASK-219: Access-activated handler, templates and date formatting

- `access-templates.ts`: `ACCESS_TEMPLATES = { activated: 'Halo {nama}, aksesmu ke {creator} sudah aktif sampai {tanggal}. Selamat mengobrol.', reminder: 'Halo {nama}, aksesmu ke {creator} berakhir {tanggal}. Hubungi admin bila ingin memperpanjang.', ended: 'Halo {nama}, aksesmu ke {creator} sudah berakhir. Terima kasih sudah bergabung.' }` (verbatim from `AdmSetNotif`; US-045 uses the other two) and `renderTemplate(template, vars)` (only the three known variables; unknown `{x}` left as is).
- `access-date.ts`: `formatAccessDate(date, timeZone)` → `27 Nov 2026, 23.59 WIB` (Indonesian short months, `.` between hour and minute, zone label WIB/WITA/WIT for Asia/Jakarta, Makassar, Jayapura, else `UTC+n`). Reuse the Mini App's formatter logic if it is already in a shared package; otherwise implement here with `Intl.DateTimeFormat` parts and test the DST-free fixed offsets.
- `access-activated-handler.ts`: `AccessActivatedHandler` for `subscription.granted` / `subscription.extended`. `resolve`: load the `subscription_events` row by `payload.event_id` and check `subscription_id = event.aggregateId`; load subscription, customer (`id, telegramId, displayName, timezone, status, botBlockedAt`), creator (`displayName`, `status`, user status); apply the skip rules; find the pair's conversation → path `/chats/<id>` (fallback `/subscriptions`); build the message (`buttonText: BOT_COPY.menuButton`); `dedupeKey = subscription_event:<id>:telegram`, `kind = 'access_activated'`.
- `BOT_COPY` gets no new keys (templates are their own module).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/notifications/access-templates.ts` | default templates + renderer |
| CREATE | `packages/backend-core/src/notifications/access-date.ts` | `formatAccessDate` |
| CREATE | `packages/backend-core/src/notifications/access-activated-handler.ts` | handler |
| MODIFY | `packages/backend-core/src/notifications/index.ts` | exports |

**Testing:**
- `access-date.spec.ts`: Jakarta / Makassar / Jayapura / `America/New_York` fixtures, midnight and 23.59 edges.
- `access-templates.spec.ts`: variables replaced, a name containing `{creator}` is not re-expanded.
- `access-activated-handler.int.spec.ts` (fake sender): grant → one SENT with the right text and chat path; extend → second delivery; revoked before delivery → SKIPPED `revoked`; ended → SKIPPED; blocked customer / creator / bot-blocked → SKIPPED; event of another subscription (forged `event_id`) → FAILED, nothing sent; duplicate job → one send; 429 then success; ambiguous timeout counted.

---

### TASK-220: Worker wiring, end-to-end test and docs

- `apps/worker/src/notifications.ts`: build the runner and `NotificationRouter([CreatorResultHandler, AccessActivatedHandler])`; the `OutboxDispatcher.handledTypes` = router types; consumer handler = `router.process`.
- End-to-end test (`apps/worker/src/pipeline.int.spec.ts` style, real Postgres + Redis, fake sender): admin grant through `SubscriptionAccessService` → event dispatched → one Telegram message → delivery SENT.
- Docs: `codebase-map.md` (router, handler contract, templates), `design-integration.md` Known Gaps US-020 note ("promise a Telegram notification that is not sent until Phase E" → now sent; text is the `AdmSetNotif` default).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/worker/src/notifications.ts` | router + handlers |
| MODIFY | `apps/worker/src/pipeline.int.spec.ts` | grant → Telegram end to end |
| MODIFY | `.agile/guidelines/codebase-map.md`, `.agile/guidelines/design-integration.md` | what exists |

**Testing:**
- The end-to-end case above; a second case where the worker is "down" (event stays PENDING) and processes it after start.
- Whole worker and backend-core suites; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
