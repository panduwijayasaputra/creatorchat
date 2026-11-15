# QA Report: TASK-045 — API integration — session and role enforcement matrix

**Result:** PASS

## Checked
- `test/session-enforcement.int.spec.ts` (9 tests, real PostgreSQL + Redis, full Nest app): forged / garbage / wrong-secret / deleted-session tokens give 401; wrong role gives 403 `FORBIDDEN_ROLE` in both directions; USER to CREATOR change kills the old token (401), a fresh login gets the new role and then 403 on USER-only routes; blocked account: old token 401 on HTTP, `authorizeConnection` rejects, relogin gives 403 `ACCOUNT_BLOCKED` and creates no session row; unblock allows login but never revives the old session; an admin token is refused on user routes and a user token on the admin API (cookie and Bearer); forged user id / role / telegram id in query, body and headers are ignored; IDOR: own record 200, another user's id, a random uuid and a malformed id give byte-identical 404s.
- The IDOR and role routes are TEST-ONLY (`test/support/enforcement-fixtures.ts`, registered only through `buildTestApp(env, [module])`, never in `AppModule`). No product endpoint takes a user-owned id yet, so this proves the pattern, not a product endpoint.
- Socket connect is covered by `authorizeConnection` (a function), not by a live socket: there is no gateway yet.

## Not verified here
- A live Socket.IO connection (no gateway exists; the rule is `authorizeConnection`, tested as a function).
- The blocked-account screen against a design (no board exists).
- Behaviour inside the real Telegram WebView.
