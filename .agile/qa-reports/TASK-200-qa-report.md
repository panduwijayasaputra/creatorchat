# QA Report: TASK-200 — API — customer gallery endpoints

**Result:** PASS (US-034, 2026-11-18)

## Built
`GET /v1/creators/by-code/:publicCode/gallery[/:assetId]` in `CreatorsController` (`@Roles('USER')`, `no-store`), `CUSTOMER_GALLERY` provider, new shared `StorageModule`.

## Verified
10 integration tests: active subscriber gets the list and detail and the signed links serve the exact files; guest, expired, revoked and pending-only customers get 403 `GALLERY_ACCESS_REQUIRED` on all four route shapes with only code / message / request_id in the body and no id echoed; CREATOR token 403 `FORBIDDEN_ROLE`, blocked customer and no token 401; unknown, malformed and blocked-creator codes one 404 `CREATOR_NOT_FOUND`; another creator's asset and malformed ids 404 `MEDIA_NOT_FOUND`; access ending mid-session gives 403; the profile endpoint's JSON has no media field. Responses hold no state, key or creator id. `roles-declared` still passes.

## Notes
One unrelated admin test (`admin-user-detail`, request filters) failed once in a full run and passed three of three times alone; it looks order- or timing-dependent.
