# QA Report: TASK-239 — Worker scheduler loop, end-to-end tests and docs

**Result:** PASS (US-045, 2026-11-21)

## Built
`apps/worker/src/access-scheduler.ts` (`runLockedScan` with a transaction-scoped advisory lock, `startAccessScheduler`), started inside `startNotifications`; the router gets `accessReminderHandler`. Docs: codebase-map, tech-stack decision note.

## Verified
- `access-scheduler.int.spec.ts` (6 cases): the scan runs when free; another worker holding the lock → `locked` and no scan, then it runs once released; the lock is gone after an error; a real scheduler writes the reminder once however often it scans; a failing scan is logged once, the loop continues and the recovery is logged, with no connection string in the logs; never two scans at once in a process and `stop` waits for the running one.
- `pipeline.int.spec.ts` (+5, real scheduler, PostgreSQL and Redis, fake Telegram): a reminder for an access ending in 2 days is sent once however long the scheduler runs; nothing twice across a worker restart; an access that just ended gets the ended notice and no reminder; revoked and far-from-end accesses get nothing; a permanently failed notice leaves the access untouched. 20 pipeline tests pass.
