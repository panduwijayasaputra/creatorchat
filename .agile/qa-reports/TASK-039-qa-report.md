# QA Report: TASK-039 — API — `GET /v1/creators/by-code/:publicCode`

**Result:** PASS

## Checked
- `apps/api/test/creator-link.int.spec.ts` (real DB + Redis): exactly three fields returned and nothing written; unknown, malformed, blocked-creator and blocked-account codes give byte-identical 404 bodies (except `request_id`); no token, malformed token, revoked session, stale `session_version` and blocked caller all give 401; an admin access token as Bearer gives 401; a CREATOR gets 403 `FORBIDDEN_ROLE` for their own and another creator's code and keeps the role; forged role/user headers and query parameters are ignored.
- The CREATOR 403 is a local check; US-006 should replace it with the shared roles guard and keep the code and status.

## Not verified here
- Real Telegram behaviour (see TASK-042).
