# QA Report: TASK-245 — Migration and first-grant event

**Result:** PASS (US-041, 2026-11-21)

## Built
`20261205010000_welcome_deliveries` + the `WelcomeDelivery` model; `OutboxEventType.WELCOME_REQUESTED`; `SubscriptionAccessService.grant` writes `welcome.requested` (ids only, dedupe `welcome:<creator>:<customer>`) in the grant transaction when the grant creates the subscription row.

## Verified
- `packages/db/test/welcome-deliveries.int.spec.ts` (4 cases): starts without a message and with its own id; one per creator and customer; links to one message at most and the message cannot be deleted; an existing creator and customer are required. `identity-baseline` table list updated.
- `subscription-access.service.int.spec.ts` (+4, two existing assertions updated for the second event): a first grant writes the request with ids only; a second creator gets its own; extend, revoke and a re-grant after a revoke or an expiry write none; two parallel first grants write one; the rolled-back grant still writes nothing. The 27 access tests pass.
