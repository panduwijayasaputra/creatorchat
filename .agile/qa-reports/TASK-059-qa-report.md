# QA Report: TASK-059 — Timezone contract, `timezone` in the shared profile, `ProfileService.updateOwnTimezone`

**Result: PASS** (2026-11-16)

- `timezone.ts`: `TIMEZONE_OPTIONS` (the five `CrTimezone` zones), `TimezoneIdSchema` (enum), `UpdateTimezoneRequestSchema` (plain object: unknown keys stripped). The schema rejects `UTC`, `Asia/Tokyo`, empty, lowercase, trailing space, numbers, null, arrays and a missing key.
- `utcOffsetLabel` uses `Intl` `longOffset` at the given date: Jakarta, Makassar, Jayapura and Singapore are fixed year-round; Sydney is `UTC+11` on 2026-11-16 and `UTC+10` on 2026-07-01 (the board's static "UTC+11" would be wrong in winter); half-hour zones and UTC format correctly; unknown ids return an empty string (no throw). `timezoneSummary` gives `WIB · Asia/Jakarta (UTC+7)` and the raw id for a zone outside the list.
- `UserProfileSchema` gained `timezone`; `toUserProfile` returns it; fixtures updated (contracts, miniapp client and fake, visual harness). A login assertion checks the default `Asia/Jakarta`.
- `ProfileService.updateOwnTimezone(userId, timezone, role)` shares one `ownActiveRow` filter with `updateOwnProfile` (ACTIVE user, expected role, ACTIVE creators row for CREATOR). Integration tests: changes only the timezone, harmless twice, default for new accounts, other accounts untouched, blocked user / blocked or missing creators row / role mismatch rejected with nothing written. No migration (column already existed).
- Checks: contracts 75, backend-core 173; typecheck and lint pass.
