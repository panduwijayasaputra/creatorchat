# QA Report: TASK-062 — Contracts, migration (`creator_applications`, `subscriptions`) and seed

**Result: PASS** (2026-11-16)

- `creator-request.ts`: `SubmitCreatorRequestSchema` is a plain object (unknown keys such as `user_id`, `role`, `status`, `id` stripped). The Instagram check accepts only http(s) `instagram.com` / `www.instagram.com` with one handle segment (`[A-Za-z0-9._]{1,30}`), no userinfo, no port; query and fragment are dropped and the value is normalised to `https://instagram.com/<handle>`. Look-alike hosts (`instagram.com.evil.com`, `evil.com/instagram.com/x`, `m.instagram.com`), `javascript:`, `ftp:`, extra path segments, 31-char handles and encoded spaces are rejected. Name 1-40 and description 1-300 are counted in code points and reject control characters (the description allows newlines). `rights_confirmed` must be the literal `true`. The three board error texts are verbatim, including when a field is missing altogether.
- `ErrorCode.CREATOR_REQUEST_BLOCKED` added. Response schemas are strict.
- Migration `20261119010000_creator_applications_subscriptions`: two enums, two tables with RESTRICT foreign keys, `UNIQUE (customer_id, creator_id)`, a **partial unique index** (one PENDING per user), CHECKs for the review combination (PENDING has no review data, REJECTED has time and reason) and `ends_at > starts_at`. No data is changed. Applied to the test database through the normal `migrate deploy` in global setup. The dev database needs `pnpm db:migrate`.
- Seed: Raka Putra gets one active subscription to Salsa until 2026-11-27; a second run creates nothing. The seed still refuses production and the test database.
- Tests: contracts 109 pass; db 70 pass (second PENDING rejected, PENDING allowed again after REJECTED / APPROVED and for another user, CHECKs, RESTRICT delete, subscription pair and period). The identity-baseline scope test now lists the two new tables. `resetDatabase` truncates them.
- `pnpm typecheck` and `pnpm lint` pass for db and contracts.

## Not verified here
- Migration against a populated dev database (the tables are new, so no existing rows are touched).
