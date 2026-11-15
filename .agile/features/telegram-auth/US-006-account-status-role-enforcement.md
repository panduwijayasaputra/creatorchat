# US-006: Account status and role enforcement on every session

**Status:** ready_for_uat
**Priority:** high
**Feature:** telegram-auth
**Phase:** A
**Roles:** USER, CREATOR, System
**Brief refs:** §3 (one account, one role; stale sessions lose privilege), §6 (block vs expiry), §15, §17 (role change invalidates stale access; IDOR)
**Design refs:** `AuthMain` (rules), `AuthStates` ("Sesi Telegram berakhir"). Blocked-account message in the Mini App: not designed — gap

## Description

As the platform, I want every request and socket connection to be checked against the account's current status and role, so that a blocked account or an old session can never keep acting with privileges it no longer has.

## Acceptance Criteria

- [x] Every user endpoint declares which role may call it (USER or CREATOR) and the server enforces it; calling a CREATOR endpoint as USER (or the reverse) returns 403 regardless of what the UI shows.
- [x] Each session records the user's `session_version`. When an account is blocked or its role changes, `session_version` is incremented, and the next sensitive request or socket connection made with an older session is rejected; the Mini App then shows the "Sesi Telegram berakhir" state and re-authenticates via `initData`.
- [x] A BLOCKED account cannot obtain a new session and existing sessions stop working. Block is distinct from subscription expiry (no subscription logic is touched here). The Mini App shows a non-final placeholder message for blocked accounts until it is designed.
- [x] Identity always comes from the session: user IDs, roles, or Telegram IDs sent in a body, query, or header are ignored. Endpoints taking an ID scope the lookup by the current user, and another user's ID returns 404 (covered by an integration test).
- [x] Integration tests against the test database prove: forged session rejected; role change from USER to CREATOR invalidates the old session's USER-only access; blocked user rejected on HTTP and on the connection check (`authorizeConnection`; a live socket test waits for the Phase C gateway); admin and user sessions can't be used interchangeably.

## Tasks

### TASK-043: backend-core — `AccountSecurityService` and `authorizeConnection`
**Status:** done

### TASK-044: API — `@Roles()` + `RolesGuard`, apply to existing user routes
**Status:** done

### TASK-045: API integration — session and role enforcement matrix
**Status:** done

### TASK-046: Mini App — role-gated routes, blocked placeholder, session-ended path
**Status:** done

### TASK-047: Verification, docs, and map
**Status:** done
