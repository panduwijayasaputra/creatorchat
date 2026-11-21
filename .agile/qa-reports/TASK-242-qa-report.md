# QA Report: TASK-242 — API: welcome message endpoints

**Result:** PASS (US-040, 2026-11-21)

## Built
`CreatorWelcomeController` (`GET` / `PUT /v1/creator/welcome-message`, `@Roles('CREATOR')`, `no-store`), provider and module wiring, `welcome_enabled` in `GET /v1/creator/settings`.

## Verified
- `apps/api/test/creator-welcome.int.spec.ts` (8 HTTP cases): off and empty first, no-store, nothing written; PUT saves text and a gallery file and a GET shows the same, no storage key in the body; an upload for the welcome message shows UPLOAD, stays out of the gallery and a repeat is identical; the settings show whether it is on; no token 401, customer 403 `FORBIDDEN_ROLE`, blocked account 401, blocked creator 404; another creator's file, a broadcast file and an unknown id answer the identical 404 `MEDIA_NOT_FOUND`; 409 `MEDIA_NOT_READY`; 400 for the switch on without text, an unknown key (a creator id), a missing key and a non-boolean.
- `roles-declared.spec.ts`, `creator-settings` and `creator-timezone` API specs pass.

## Notes
- No rate limit beyond the session (a cheap own-settings write, like the other creator settings); Phase H adds global limits.
