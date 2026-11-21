# QA Report: TASK-225 — API: POST /v1/creator/broadcasts

**Result:** PASS (US-038, 2026-11-21)

## Built
`CreatorBroadcastController` (`@Roles('CREATOR')`, `no-store`, 201 / 200), `CREATOR_BROADCAST` provider with the Redis limiter (test prefix `test:broadcast:create`), module wiring. The upload-init controller already passes `purpose` through.

## Verified
- `apps/api/test/creator-broadcast.int.spec.ts` (9 HTTP cases): 201 with id and status only (no recipient or asset in the body), nothing delivered yet; the gallery box; 200 replay / 409 conflict; no token 401, customer 403 `FORBIDDEN_ROLE`, blocked account 401; blocked creator 404; IDOR (another creator's asset, unknown id) → identical 404 `MEDIA_NOT_FOUND`; 409 `MEDIA_NOT_READY` and `NO_ACTIVE_SUBSCRIBERS`; 400 for unknown key, missing attachment, blank text, box with a gallery file; 429 with `Retry-After` after ten sends.
- `apps/api/test/roles-declared.spec.ts` passes.
