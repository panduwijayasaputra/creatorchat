# QA Report: TASK-190 — `MediaUploadService`, `MediaAccessService`, sniffing (backend-core)

**Result:** PASS (US-032, 2026-11-18)

## Built
`sniffMediaType`, `MediaUploadService` (init, complete, get, listGallery, markProcessed, markFailed, cleanup) and `MediaAccessService`; `media.uploaded` outbox type.

## Verified
22 integration tests plus sniff tests: replay returns the same asset with a fresh URL, another creator's id is a separate asset, over-limit and wrong type store nothing, rate limit refuses the 31st init, blocked creator and non-creator are refused; complete: missing object stays PENDING (409 path), wrong magic and size mismatch become FAILED and delete the object, a good file becomes PROCESSING with exactly one outbox row even for three concurrent calls, another creator's id is not found; markProcessed twice gives one gallery item and two concurrent assets get seq 1 and 2; cleanup removes old PENDING / FAILED rows and objects and never READY or recent ones; the gallery is READY-only, newest first, cursor-stable across a new insert, and holds no keys.

## Notes
Services return outcome unions (house style) instead of throwing; the controller maps them. Thumbnail links are signed after one batched ownership query.
