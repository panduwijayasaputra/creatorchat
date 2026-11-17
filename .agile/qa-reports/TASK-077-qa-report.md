# QA Report: TASK-077

**Verdict:** PASS

## Verified (run)
- `OutboxDispatcher` integration (real PostgreSQL, in-memory queue), 12 cases: a PENDING event is enqueued once with job id = event id and marked ENQUEUED; future, unhandled, DONE and FAILED events never claimed; two racing dispatchers enqueue each of 12 events exactly once (`SKIP LOCKED`); a queue failure leaves the row PENDING and keeps no error text; batch size respected; reconciler re-queues a stale ENQUEUED event (crash with no job) and it is enqueued again; a fresh ENQUEUED row, DONE/FAILED and unhandled rows are untouched; a stale SENDING delivery becomes an ambiguous retry with a 5 s backoff; a stale SENDING delivery at the attempt cap becomes FAILED.
- `backoff.spec` (4 cases). Found and fixed by the test: `backoffMs(NaN)` returned `undefined`.
