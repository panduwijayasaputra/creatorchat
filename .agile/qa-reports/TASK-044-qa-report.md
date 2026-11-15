# QA Report: TASK-044 — API — `@Roles()` + `RolesGuard`, apply to existing user routes

**Result:** PASS

## Checked
- `roles.guard.spec.ts` (5 tests): allowed role passes, other role 403 `FORBIDDEN_ROLE`, handler metadata overrides the class, a route without a declaration is refused (fail closed), no user on the request is refused.
- `test/roles-declared.spec.ts` walks every controller of the built app and fails when a route under `UserJwtGuard` lacks `RolesGuard` or `@Roles()` (it asserts it found at least two user controllers, so it cannot pass vacuously).
- `/v1/me` declares both roles, the creator resolver `@Roles('USER')`. The US-005 local role check was removed from `CreatorLinkService` and the controller; the existing creator-link integration tests still pass with the same 403 body, now proven through the shared guard.

## Not verified here
- A live Socket.IO connection (no gateway exists; the rule is `authorizeConnection`, tested as a function).
- The blocked-account screen against a design (no board exists).
- Behaviour inside the real Telegram WebView.
