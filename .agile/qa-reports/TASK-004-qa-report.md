# QA Report: TASK-004 — Prisma identity-baseline migration

**Result:** PASS
**Date:** 2026-11-15

## Checked (real PostgreSQL 18, creatorchat_test)
- The migration applied cleanly to the dev DB (migrate dev) and to the test DB (migrate deploy). Only users, admin_accounts, sessions, audit_logs (+ _prisma_migrations) exist.
- 17 integration tests: USER/ACTIVE/session_version defaults and UUID ids; duplicate telegram_id rejected; telegram_id above 2^53 stored exactly; timestamptz columns; uppercase and duplicate admin usernames rejected; session CHECK (both owners / no owner rejected); duplicate refresh-token hash rejected; a user with sessions cannot be deleted; audit_logs UPDATE and DELETE rejected by the DB trigger (row unchanged) and via Prisma.
- Note: the trigger raises restrict_violation, which Prisma labels "Foreign key constraint violated"; tests assert the DB message through raw SQL.
