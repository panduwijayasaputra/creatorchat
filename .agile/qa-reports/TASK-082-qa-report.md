# QA Report: TASK-082

**Verdict:** PASS

## Verified (run)
- `CreatorListService` integration (19 cases, real PostgreSQL, injected clock): approved and rejected applications are never rows; a resubmission after a rejection gives one request row; approving through `CreatorApprovalService` turns the row into one ACTIVE row; exact row shape; non-https avatar dropped; `has_active_subscription` true for active and future, false for revoked and expired; subscriber count excludes expired, not-started and revoked; filters status/type/range (3, 20, 60, 200 days)/name (case-insensitive)/Telegram id prefix/combined; `% _ \` literal and a SQL-looking `q` harmless (users table intact); every sort field both ways, subscribers sorts requests last in both directions, ties stable; pages disjoint and equal the whole set, total independent of page, past-the-end page → `[]` with true total.
- ORDER BY text comes only from a fixed map; all values are bound parameters.
