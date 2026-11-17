# QA Report: TASK-109

**Verdict:** PASS

## Verified (run)
- `UserModerationService` integration (12 cases, real PostgreSQL): block sets BLOCKED, bumps `session_version`, revokes live sessions and writes **one** `user.account.blocked` row (admin id, target, reason, request id); subscriptions and a PENDING creator request are byte-identical after block and after unblock; already-blocked → conflict with nothing written; creators → `role_conflict` for block and unblock, nothing written; two concurrent blocks → one ok and one audit row; concurrent block + unblock serialise without deadlock and the final status matches the outcomes; **block vs approval** of the same applicant ends in exactly one consistent state (blocked USER + approval not-eligible, or CREATOR + block role-conflict); unblock restores ACTIVE, bumps the version again, audits with the reason, touches no subscription; unknown, malformed and SQL-looking ids → `not_found`; the pre-check counts only running, non-revoked subscriptions and writes nothing. Run three times for flakiness.
- A first version of the block-vs-unblock test expected exactly one `ok`; both succeeding in order is correct, so the test now asserts the outcome/final-state pair.
