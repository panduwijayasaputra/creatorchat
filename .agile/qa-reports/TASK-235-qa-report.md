# QA Report: TASK-235 — API: preferences and mute endpoints

**Result:** PASS (US-043, 2026-11-21)

## Built
`NotificationsController` + module (`GET` / `PATCH /v1/me/notification-preferences`, `PUT` / `DELETE /v1/creators/by-code/:publicCode/mute`), all `@Roles('USER')` and `no-store`; `/v1/subscriptions` passes `muted` through.

## Verified
- `apps/api/test/notification-preferences.int.spec.ts` (10 HTTP cases): defaults first and nothing written; PATCH changes only the named switch and answers the whole state, a GET sees it; one customer's choices never reach another; empty body, an unknown key (a user id included) and a non-boolean → 400 `VALIDATION_FAILED` with nothing stored; no token 401, creator 403 `FORBIDDEN_ROLE`, blocked account 401; mute / unmute are repeatable and the Langganan card shows `muted`; unrelated, unknown and malformed creators answer the identical 404 `CREATOR_NOT_FOUND`; a blocked creator cannot be muted (same 404) but an earlier mute can still be undone; a customer without the relation cannot undo someone else's mute; creators get 403 on the mute routes.
- `apps/api/test/roles-declared.spec.ts` passes (every route declares `@Roles`); `subscriptions.int.spec.ts` passes.
