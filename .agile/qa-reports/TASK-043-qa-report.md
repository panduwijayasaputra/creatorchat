# QA Report: TASK-043 — backend-core — `AccountSecurityService` and `authorizeConnection`

**Result:** PASS

## Checked
- `account-security.service.int.spec.ts` (6 tests, real PostgreSQL): block sets status, bumps `session_version` once, revokes every live session of that user only and writes one audit row (actor, reason, request id, from/to); blocking twice changes nothing; six concurrent blocks serialize on the row lock into exactly one bump and one audit row; role change records from/to, bumps, revokes, is a no-op for the same role and creates no `Creator` row; unblock bumps again and leaves old sessions dead; unknown user gives `not_found`.
- `authorize-connection.int.spec.ts` (7 tests): live session accepted; CREATOR rejected where only USER is allowed (role read from the live row); garbage, tampered and wrong-secret tokens, a revoked session, an expired token, a stale session after role change and after block, a blocked account with a live session row and an admin access token are all `unauthenticated`.
- The function reuses `UserAuthService.authenticate`, so HTTP and connections share one rule set.

## Not verified here
- A live Socket.IO connection (no gateway exists; the rule is `authorizeConnection`, tested as a function).
- The blocked-account screen against a design (no board exists).
- Behaviour inside the real Telegram WebView.
