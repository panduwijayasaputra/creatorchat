# QA Report: TASK-122 - SubscriptionDetailService and CreatorSubscribersService (US-021)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks
backend-core integration (real PostgreSQL): detail status / dates / latest GRANT admin, IDOR (another user, creator id, admin id, unknown, malformed → null), events (labels, summaries '30 hari', audit link, sorts, paging, never reason or admin id), subscribers (only this creator, status derivation, filters, name / Telegram prefix / literal LIKE search, sorts, paging, non-creator ids null), grantable users (excludes entitled, blocked, creators; includes expired / revoked; cap 20; blocked creator). Also a new assertion that a grant stores `audit_log_id`.

Full runs: contracts 221, backend-core 386, api 266, admin 293 passed; ESLint and `tsc --noEmit` clean for all packages and the visual specs.

## Notes
**Deviation from the plan:** US-020 was already built without `audit_log_id`, so this story adds the column in its own migration `20261123010000_subscription_event_audit_link` and changes `SubscriptionAccessService` to write the audit row first (the events table is append-only, so the id must be stored with the event). The audit row no longer carries `event_id`. Run `pnpm db:migrate` on the dev database; the test database is migrated automatically.
