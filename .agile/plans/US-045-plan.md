# Technical Plan: US-045 — Access reminder and access ended notifications

## Architecture Overview

Agreed with the user (2026-11-21): reminder **3 days before** `ends_at`, one config value.

```
worker AccessScheduler (every 60 s, advisory lock)
   └─ AccessScheduleService.scan(now)
        reminder: active subs ending within the lead time ─▶ outbox subscription.reminder_due   (dedupe: subscription:<id>:ends:<ms>:reminder)
        ended   : subs that ended in the last 3 days     ─▶ outbox subscription.ended          (dedupe: subscription:<id>:ends:<ms>:ended)
existing notifications pipeline ─▶ AccessReminderHandler ─▶ TelegramDeliveryRunner ─▶ bot
```

- **Time-based events enter the same outbox** so retries, backoff, bot-blocked, reconciler and logging are the ones of US-013/US-044; the scheduler only decides *which* events exist. The dedupe key includes the `ends_at` epoch (ms), so an extension creates a new period with its own reminder and ended notice, and re-running the scan never duplicates.
- **Handler re-checks at delivery** (state may have changed between scan and send): payload `ends_at` must still equal `subscriptions.ends_at` (else SKIPPED `extended`), not revoked, not blocked; a reminder is never sent once `ends_at <= now` (SKIPPED `already_ended`); an ended notice only when `ends_at <= now`.
- **Catch-up window.** The scanner looks back 3 days for ended notices (`ENDED_LOOKBACK`), so a worker outage does not lose them and a first deploy does not message old, long-expired subscriptions. Reminders only exist while `ends_at > now`, so after an outage a reminder is never created for an access that already ended.
- Access expiry itself stays purely time-based in the entitlement SQL; nothing here changes access.
- Templates: `ACCESS_TEMPLATES.reminder` / `.ended` from US-044 (`AdmSetNotif` verbatim). Deep link `/subscriptions` (Langganan page, where the customer can ask for an extension).

Brief refs: §6, §9, §11, §19 (reminder default is an open input; 3 days chosen, configurable). Design refs: `AdmSetNotif` (templates), `AdmLogNotif` ("Akses berakhir 3 hari lagi").

## Authorization & Data Rules

- No HTTP surface; recipient, creator name and date from the database by subscription id; payload never trusted for text.
- Scanner selects only subscriptions with `revoked_at IS NULL`, customer ACTIVE, creator ACTIVE (+ creator user ACTIVE). Revoked access gets neither notice (an admin action, not expiry).
- Dedupe: outbox `dedupe_key` (above) and `notification_deliveries.dedupe_key` `subscription:<id>:ends:<ms>:<kind>:telegram` (unique).
- Scan batches of 500 per query with `ORDER BY ends_at, id`, repeated until a batch is short; one `INSERT … ON CONFLICT DO NOTHING` per event through `OutboxService.add` inside one transaction per batch.
- Overlapping scans (two workers) are harmless (dedupe); a `pg_try_advisory_lock` keeps them from doing the work twice.
- Logs: counts per scan only.

## Dependencies

- US-044 (router, templates, `formatAccessDate`), US-013 (pipeline), US-020 (subscriptions), US-009 (timezone). New env `ACCESS_REMINDER_LEAD_DAYS` (optional integer 1–30, default 3) in `ServerEnv` + `.env.example` + `CONFIGURATION.md` (server only). No new packages.

## Risks

- **Very short grants** (≤ 3 days) trigger the reminder right after the activation notice. Accepted (the dates make sense); revisit with real pilot feedback.
- **Clock/timezone:** all comparisons in UTC with `timestamptz`; only the text uses the customer's zone.
- **Large backlogs after long downtime:** batch loop + the 3-day look-back bound the work.

## Tasks

### TASK-237: Config, event types and `AccessScheduleService`

- `ServerEnv`: `ACCESS_REMINDER_LEAD_DAYS` (default 3); docs in `.env.example` and `CONFIGURATION.md`.
- `OutboxEventType`: `SUBSCRIPTION_REMINDER_DUE: 'subscription.reminder_due'`, `SUBSCRIPTION_ENDED: 'subscription.ended'`.
- `packages/backend-core/src/notifications/access-schedule.service.ts`: `AccessScheduleService(prisma, outbox, {leadDays, endedLookbackDays = 3, clock})` with `scan(now?): Promise<{reminders: number, ended: number}>` as designed; payload `{subscription_id, customer_id, creator_id, ends_at: ISO}`; aggregate `subscription`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/backend-core/src/config/env.ts` (+ spec), `.env.example`, `CONFIGURATION.md` | lead time |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | event types |
| CREATE | `packages/backend-core/src/notifications/access-schedule.service.ts` (+ int spec) | scanner |

**Testing (integration, fake clock):**
- Subscription ending in 2 days → one reminder event; ending in 5 days → none; scan twice → still one; extended after the scan → the new `ends_at` gets its own event later.
- Ended 1 hour ago → one ended event; ended 4 days ago → none; revoked / blocked customer / blocked creator → none.
- Already ended subscription never gets a reminder; a subscription granted yesterday for 2 days gets one reminder.
- Batch loop with > 500 rows; env default 3 and override.

---

### TASK-238: Reminder / ended handler

`packages/backend-core/src/notifications/access-reminder-handler.ts`: `AccessReminderHandler` for `subscription.reminder_due` and `subscription.ended`; `resolve` loads the subscription, customer, creator, applies the delivery-time checks above, renders `ACCESS_TEMPLATES.reminder` (`{tanggal}` = `formatAccessDate(ends_at, customer.timezone)`) or `.ended` (no date), path `/subscriptions`, `kind = 'access_reminder' | 'access_ended'`, `dedupeKey = subscription:<id>:ends:<ms>:<kind>:telegram` where `<ms>` comes from the payload and must equal the subscription's current `ends_at` epoch.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/notifications/access-reminder-handler.ts` (+ int spec) | handler |
| MODIFY | `packages/backend-core/src/notifications/index.ts` | exports |

**Testing (integration, fake sender):** reminder text and date in the customer's timezone; ended text; extended after scan → SKIPPED `extended`; revoked → SKIPPED; reminder after `ends_at` → SKIPPED `already_ended`; ended before `ends_at` → SKIPPED `not_ended`; blocked / bot-blocked → SKIPPED; duplicate job → one send; Telegram 429 / blocked / ambiguous outcomes as US-013; forged payload `ends_at` ≠ stored → SKIPPED.

---

### TASK-239: Worker scheduler loop, end-to-end test and docs

- `apps/worker/src/access-scheduler.ts`: `startAccessScheduler({prisma, logger, leadDays, intervalMs = 60_000, clock?})` — timer loop (no overlap within the process, errors logged and the loop continues), `pg_try_advisory_lock` around each scan, `stop()` for shutdown. Wired from `worker.ts` / `notifications.ts` together with the notification pipeline (only when notifications are configured).
- Router gets `AccessReminderHandler`; dispatcher `handledTypes` extended.
- End-to-end: seeded subscription ending in 2 days + fake clock → scan → dispatch → one reminder SENT; the day after the end → one ended SENT; worker restart re-scan sends nothing new.
- Docs: `codebase-map.md` (scheduler, events, env), `tech-stack.md` decisions log (3-day default, in-process scheduler with dedupe + advisory lock).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/worker/src/access-scheduler.ts` (+ spec) | loop |
| MODIFY | `apps/worker/src/notifications.ts`, `worker.ts`, `pipeline.int.spec.ts` | wiring + e2e |
| MODIFY | `.agile/guidelines/codebase-map.md`, `tech-stack.md` | docs |

**Testing:** loop does not overlap and survives a thrown scan error; e2e cases above; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
