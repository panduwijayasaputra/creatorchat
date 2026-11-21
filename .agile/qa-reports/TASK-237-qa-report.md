# QA Report: TASK-237 — Config, event types and AccessScheduleService

**Result:** PASS (US-045, 2026-11-21)

## Built
`ACCESS_REMINDER_LEAD_DAYS` (server env, 1–30, default 3; `.env.example`, `CONFIGURATION.md`), event types `subscription.reminder_due` / `subscription.ended`, `AccessScheduleService.scan` (keyset paging, configurable batch, dedupe key with the end time).

## Verified
- `env.spec.ts` (+2): default 3, 1–30 accepted, 0 / 31 / 2.5 / text / -1 refused.
- `access-schedule.service.int.spec.ts` (12 cases, real PostgreSQL, controlled clock): a reminder only within the lead time and with its payload / dedupe key; scanning again or at the next tick writes nothing; an extension is a new period with its own reminder; never for an ended, revoked, blocked-customer or blocked-creator subscription or one that has not started; the lead time is configurable; ended notice once within 3 days and not for older, revoked or blocked; a worker that was down catches up (ended notice yes, reminder never); reminder then ended are two separate events; paging through several batches and two overlapping scans write each event once.
