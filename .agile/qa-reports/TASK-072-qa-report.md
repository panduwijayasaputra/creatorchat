# QA Report: TASK-072

**Verdict:** PASS

## Verified (run)
- Migration `20261120010000_creator_review_outbox` (written by hand because earlier migrations carry future-dated prefixes; the SQL is Prisma's own diff) applied to the dev database with `pnpm db:migrate` and to the test database by the global setup. `creators.creator_type` is `NOT NULL DEFAULT 'HUMAN'` and `instagram_url` is nullable, so existing rows stay valid; `outbox_events` has a UNIQUE `dedupe_key` and an index on `(status, available_at)`. The identity-baseline scope test now lists `outbox_events`.
- `OutboxService` (6 integration cases): a PENDING event with the payload; a repeat with the same dedupe key writes nothing and reports `created: false`; two concurrent writes leave one row; the event rolls back with the surrounding transaction; a free-text payload entry, an unsafe key and a non-finite number are refused without echoing the text.
- Seed: 3 pending/rejected requests (Maya pending, Raka pending, Luna rejected), idempotent; seed creators get type and Instagram only when the seed creates them; Raka keeps his subscription next to the pending request.
- `pnpm --filter @creatorchat/db test` 74 pass; typecheck, lint, Prettier clean.

## Notes
- The seed no longer leaves Raka request-free, so his earlier US-010 "blocked" screens are not reachable in the seed (a pending request wins on the Profile). Recorded in the plan and the decisions log.
- Existing dev creators created before this migration keep an empty Instagram link; the seed does not touch existing rows.
