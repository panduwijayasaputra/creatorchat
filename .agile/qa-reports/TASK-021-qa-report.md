# QA Report: TASK-021 — Session rotation migration, shared password helpers, admin CLI

**Result:** PASS

## Checked
- Migration `20261115010000_admin_session_rotation`: adds `previous_refresh_token_hash` (unique, nullable) and `rotated_at`; additive only. Applied to the local dev DB with `prisma migrate deploy` (no reset) and to the test DB by global setup. Schema comment now says the hash is a keyed HMAC.
- Password helpers moved to `packages/db/src/admin-password.ts` and exported from `@creatorchat/db`. **Deviation from the plan (backend-core home):** backend-core will depend on db (for the Prisma client), so putting the helpers in backend-core would create a package cycle. `seed/admin.ts` re-exports them; there is one copy of `ARGON2_OPTIONS`.
- `verifyPassword` now returns false for a malformed stored hash instead of throwing. `verifyDummyPassword` added for equal-time rejection of unknown accounts.
- CLI `pnpm admin:create --username <u> [--password-env VAR] [--reset-password]`:
  - Password comes only from a named env var or is generated and printed once; `--password` is rejected as an unknown option (tested).
  - Supplied password must be at least 12 characters (not specified by the plan; added as a sane floor).
  - Refuses production and `*_test` databases, prints host/database only, never credentials.
  - Duplicate username fails without changing the account; `--reset-password` replaces the hash, revokes all open sessions and writes `admin.password.reset` (a created admin writes `admin.account.created`). Neither audit row contains a password.
- `seed` behavior unchanged (its tests still pass).

## Results
- `pnpm --filter @creatorchat/db typecheck`, `test`: 46 tests pass against the real test DB (11 new: create, generate, duplicate, invalid, reset + revoke + audit, ghost reset, rotation columns, 5 CLI guard tests).

## Notes
- Documentation of the CLI is part of TASK-026.
