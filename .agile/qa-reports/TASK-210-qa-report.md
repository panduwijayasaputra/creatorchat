# QA Report: TASK-210 — API — creator send with attachment, chat upload init

**Result:** PASS (US-036, 2026-11-18)

## Built
API: creator send accepts the new body and maps `media_not_found` (404) and `media_not_ready` (409); upload init accepts `purpose` / `conversation_id` (404 `NOT_FOUND` for a foreign conversation, 403 `CHAT_ACCESS_EXPIRED`); both histories, the chat list and the inbox carry the new fields; `StorageModule` is shared with the chat modules.

## Verified
7 HTTP tests: 201 with attachments in both histories, no origin / asset ids / keys in the customer JSON, working thumbnail link; replay 200 and conflict 409; CHAT init → PUT → complete → 409 MEDIA_NOT_READY → worker step → 201 → reuse 404 with no gallery item; foreign conversation 404, ended chat 403, missing conversation 400; another creator's asset 404, neither text nor file 400, a USER token 403; a customer cannot send an attachment (400) but sends text; an ended chat refuses the send and keeps received media readable. Chat list API test updated. Full API suite (413) passes.

## Notes
One existing admin test (`admin-user-detail`) failed intermittently in full runs; the cause was a seed that created two applications in the same millisecond, so the ordinal fell back to random ids. The seed now sets distinct times.
