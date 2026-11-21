# QA Report: TASK-230 — Worker broadcast pipeline, end-to-end tests and docs

**Result:** PASS (US-039, 2026-11-21)

## Built
`apps/worker/src/broadcast` (`BroadcastEventHandler`, `startBroadcast`), queue `broadcast`, started from `main.ts`. Docs: codebase-map, design-integration (no broadcast label in the customer chat).

## Verified
- `apps/worker/src/broadcast/broadcast.int.spec.ts` (9 cases, real PostgreSQL + Redis): the loops deliver one message per active subscriber and settle the event (the expired customer gets none, `message.created` events written); a broadcast that waited while the worker was down is delivered after start; after the loops were killed and restarted there is still one message per conversation; the logs hold neither the text nor a storage key. Handler: done → DONE; continue → PENDING without counting an attempt; missing broadcast → FAILED; an error backs off and the last attempt gives up with the safe code `fanout_error` (a connection string in the error never reaches a row); a settled event is not worked again.
- `apps/api/test/broadcast-delivery.int.spec.ts` (6 cases): the customer's history shows a normal media message (no broadcast label, id or origin), counts it unread and opens its file through the viewer endpoint; every recipient has its own attachment of the one asset and cannot open another recipient's attachment (identical 404); an expired customer has no message and no unread; the file still opens after the access ends; the creator sees the message and the upload is not in the gallery; the customer gallery routes do not reveal it.

## Notes
- QA found a real defect of US-037: the customer history handed the app the **asset id** as `attachment.id`, while the viewer endpoint takes the **attachment row id**, so the Mini App would have answered 404 for every file. Fixed by giving customers the attachment row id (`attachmentsFor(..., 'attachment')`); the creator side keeps asset ids. The assertion in `creator-chat-media.int.spec.ts` that encoded the old behaviour was updated.
- Redis was not running locally: a throwaway instance (no persistence) was started for the tests.
