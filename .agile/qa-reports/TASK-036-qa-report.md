# QA Report: TASK-036 — Database — `Creator` table (minimal) and seed fixture

**Result:** PASS

## Checked
- Migration `20261117010000_creator_public_code` (enum, table, UNIQUE `user_id` and `public_code`, FK RESTRICT, CHECK on the code format) applied to the dev DB with `migrate deploy` (no reset). The test DB is migrated by global setup.
- `creator.int.spec.ts`: valid insert, duplicate code, second creator per user, 7 malformed codes rejected by the CHECK, RESTRICT on user delete, seed creates 3 creators and is idempotent. The identity-baseline test that pins the table list was updated to include `creators`.
- No profile fields were added (Phase B).

## Not verified here
- Real Telegram behaviour (see TASK-042).
