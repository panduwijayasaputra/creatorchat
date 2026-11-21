# QA Report: TASK-246 — WelcomeDeliveryService

**Result:** PASS (US-041, 2026-11-21)

## Built
`WelcomeDeliveryService.deliver` and the shared `checkCreatorCanMessage` (extracted from the broadcast fan-out, which now uses it).

## Verified
- `welcome-delivery.service.int.spec.ts` (16 cases, real PostgreSQL, events produced by the real grant): one normal creator message (origin MANUAL, no broadcast id) in the new conversation linked to its delivery row, `client_message_id` = the row's id, announced like any message and nothing asks for an AI reply; mode and response version of an AI conversation unchanged; a gallery file is the same asset (no copy, no new gallery item); an upload for it is attached to that message only and never in the gallery; a file that is no longer usable is left out; the conversation is made when missing; the text saved at delivery is sent and a later edit never changes the message; switch off or no configuration → skipped with no delivery row; access ended, revoked, customer blocked, creator blocked, creator account blocked → skipped with nothing written (no message, no delivery row); a repeated event, a retry and a re-run write nothing more; two jobs at once write one message and one delivery row; a later extension or re-grant brings no second one; unknown event, another type and a vanished subscription → missing; customer and creator come from the subscription, never the payload.
- `broadcast` suites (27) pass after the refactor.
