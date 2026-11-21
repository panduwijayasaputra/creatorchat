# QA Report: TASK-229 — BroadcastFanOutService

**Result:** PASS (US-039, 2026-11-21)

## Built
`start` (one-statement snapshot, QUEUED → FANNING_OUT, idempotent), `deliverBatch` (one short transaction per recipient: row lock `SKIP LOCKED` → access re-check → conversation made if missing and locked → re-check → message; skip codes; technical failures counted and given up after 5), `finish` (COMPLETED, idempotent), `BroadcastProcessor` (event → broadcast from `aggregate_id`, batches within a time budget).

## Verified
- `fan-out.service.int.spec.ts` (14 cases, real PostgreSQL): N active + expired + revoked + blocked customers → exactly N messages with the same file and text, one attachment each, one asset, recipients DELIVERED, broadcast COMPLETED, only `message.created` events (no AI event); mode and response version unchanged; a late subscriber gets nothing; `start` twice does not rebuild the snapshot; access ended / revoked / customer blocked between snapshot and delivery → SKIPPED with the right code and no message; creator blocked mid-way → the rest SKIPPED `creator_blocked`; a missing conversation is made; re-running the processor or a batch changes nothing; resume after the time budget (continue → done); two workers at once → each message once, no deadlock; a permanently failing recipient is FAILED after 5 tries while the others complete; unknown event / other type / missing broadcast → `missing`; the broadcast comes from the event row, not the payload; nobody left → COMPLETED with no messages.

## Notes
- QA found and fixed a real bug: `finish()` answered false for an already COMPLETED broadcast, so a repeated job would have been queued again forever; it now answers true.
