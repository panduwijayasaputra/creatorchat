# QA Report: TASK-054 — Creator contracts, `ProfileService` role scoping, `CreatorSettingsService`

**Result: PASS** (2026-11-16)

- `CreatorSettingsResponseSchema` is strict (extra keys rejected, `bio_link` URL or null). `CreatorLinkResponseSchema` gained `bio`; all fixtures and tests updated.
- `buildBioLink` accepts only `^[A-Za-z0-9_]{5,32}$` bot usernames and returns null for unset, empty, spaces, `&`, `../` and the `<bot_username>` placeholder.
- `ProfileService.updateOwnProfile(userId, input, role)` filters the single UPDATE by id, ACTIVE status, role and (CREATOR) an ACTIVE `creators` row. Integration tests: an ACTIVE creator saves (incl. `reset_avatar`); a BLOCKED creators row, a missing creators row and a role mismatch in both directions raise `ProfileAccountNotActiveError` and write nothing. The existing USER tests pass unchanged.
- `CreatorSettingsService.get` is null without an ACTIVE creators row, for a blocked account and for a USER.
- Decisions-log rows added to `tech-stack.md`. No migration was needed (no schema change).
- Checks: contracts 67 tests, backend-core 169 tests; typecheck and lint pass.
