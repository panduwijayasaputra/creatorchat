# QA Report: TASK-028 — Database: user sessions without a refresh token

**Result:** PASS

## Checked
- Migration `20261116010000_user_session_support`: `refresh_token_hash` nullable (unique index kept), new `session_version`, CHECK `sessions_credentials_chk` (admin session needs a refresh hash; user session needs a `session_version`). Applied to the dev database with `migrate deploy` (no reset); the test database is migrated by the global setup.
- `schema.prisma` updated; client regenerated. The existing admin-auth code compiled unchanged and the whole US-003 suite (backend-core) still passes.
- New `packages/db/test/user-session.int.spec.ts` (4 tests): multiple user sessions without a hash, user session without version rejected, admin session without hash rejected, neither/both principals still rejected. The older baseline tests now pass `sessionVersion` for user sessions.
- db suite 50/50.
- Existing fixtures that insert user sessions (db baseline, admin-auth service/API tests) now pass `sessionVersion`; backend-core 64/64.
