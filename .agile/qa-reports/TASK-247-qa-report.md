# QA Report: TASK-247 — Worker welcome pipeline, end-to-end tests and docs

**Result:** PASS (US-041, 2026-11-21)

## Built
`apps/worker/src/welcome` (`WelcomeEventHandler`, `startWelcome`), queue `welcome`, started from `main.ts`. Docs: codebase-map, design-integration.

## Verified
- `welcome.int.spec.ts` (10 cases, real PostgreSQL + Redis): after the first grant the welcome text is written once into the new subscriber's chat, the event is DONE and one `message.created` follows; a welcome that waited while the worker was down is delivered after start; after the loops were killed and restarted there is still one message and one delivery row; with the switch off the event is closed as skipped (`disabled`) and switching it on later sends nothing; an extension does not send it again; the text never appears in the logs. Handler: delivered / duplicate → DONE, skipped keeps its reason as a short code, a vanished subscription fails the event, an error backs off and the last attempt gives up with `welcome_error` (a connection string in the error never reaches a row), a settled event is not worked again.
- `apps/api/test/welcome-delivery.int.spec.ts` (3 cases): the new subscriber sees a normal creator media message (no welcome label, no asset id), unread, and the file opens through the viewer; the creator's thread shows an ordinary reply of theirs and the upload never entered the gallery (own or customer gallery routes); another customer gets 404 for the chat and the file.
