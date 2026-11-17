# QA Report: TASK-073

**Verdict:** PASS

## Verified (run, real PostgreSQL)
- `AccountSecurityService` now has `…InTransaction` variants; the public methods keep their signatures and wrap them in `$transaction`. The 13 existing account-security tests pass unchanged.
- `CreatorApprovalService` (20 integration cases): approval converts the same account (same user id and Telegram id, role CREATOR, `session_version` +1, sessions revoked, `display_name` set to the requested name), creates the `creators` row with type, Instagram and a valid public code, marks the request APPROVED with admin and time, and writes the approval and `user.role.changed` audit rows and exactly one outbox event whose payload holds ids only. Reject records reason, admin and time, keeps the role and the user's session, and writes one audit row and one outbox event.
- Refused with nothing written: unknown, malformed and injection-style ids; an already APPROVED or REJECTED request; a BLOCKED account; an account that is already CREATOR; an active subscription and a **future** subscription (409 data: count, creator, end date of the one that ends last); an ended or revoked subscription does not block.
- Concurrency: two approves (one wins, one creator row, one outbox event, one version bump); approve vs reject (one decision); approve vs submit of the same user; approve vs block of the same account.
- Public code collision: an injected generator that hits an existing code retries and succeeds; when every attempt collides the approval throws and nothing is written. A code that violates the DB CHECK after the role change rolls the whole transaction back (application still PENDING, role USER).
- `pnpm --filter @creatorchat/backend-core test` 215 pass; typecheck, lint, build clean.

## Review notes
- Lock order is user row, then application row everywhere (the submit takes only the user row). The creator insert uses `ON CONFLICT DO NOTHING` so a code collision cannot abort the transaction.
- Phase C: the subscription grant must take the same user-row lock and refuse role CREATOR (recorded in the plan).
