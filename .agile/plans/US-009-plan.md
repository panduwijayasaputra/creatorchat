# Technical Plan: US-009 — Creator display timezone

## Architecture Overview

Vertical slice, agreed with the user (2026-11-16, all recommendations accepted):

1. **Contracts** — `timezone.ts`: the allowed list, request schema, label/offset helpers. `UserProfileSchema` gains `timezone`.
2. **DB** — **no migration.** `users.timezone` already exists (`TEXT NOT NULL DEFAULT 'Asia/Jakarta'`, display only).
3. **backend-core** — `ProfileService.updateOwnTimezone(userId, timezone, role)`; `toUserProfile` returns `timezone`.
4. **API** — `PATCH /v1/creator/timezone`, CREATOR-only, in the existing `creator` module.
5. **Mini App** — `/settings/timezone` (`CrTimezone`, outside the shell), the `CrSettings` "Zona waktu" row shows the current choice, and a `formatDateTime(value, timezone)` helper for every later screen that shows a time.

Brief refs: §13 (UTC storage, IANA timezone for display). Design refs: `CrTimezone` (390×844), `CrSettings` row. Resolved conflict #6 (display-only IANA timezone per account).

### Decisions (record in `tech-stack.md` decisions log in TASK-059)

| # | Decision |
|---|---|
| 1 | The server accepts **only the five designed zones**: `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`, `Asia/Singapore`, `Australia/Sydney`. One constant in `packages/contracts` (id + short name + city label) feeds the schema, the API and the screen. Anything else → 400 `VALIDATION_FAILED`. Adding a zone later is a one-line change. |
| 2 | The `UTC±X` text is **computed with `Intl` from today's date**, not copied from the board (Sydney is UTC+10 outside daylight saving, so the board's static "UTC+11" is only right Oct–Apr). The WIB/WITA/WIT names and IANA ids stay verbatim. |
| 3 | `timezone` is part of the shared `UserProfile` (login, `/me`, edit responses) so any screen can format dates; the change itself has its own CREATOR-only endpoint and never touches other fields. |
| 4 | The setting is display only: stored timestamps stay UTC, no data is rewritten. Existing rows with a value outside the list (none are created by the app) are displayed as their raw IANA id until saved, and never rejected. |

## Authorization & Data Rules

- `PATCH /v1/creator/timezone`: `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('CREATOR')`; USER → 403 `FORBIDDEN_ROLE`. No user or creator id in the request: the row is the session's. Body `{ timezone }` validated by an enum of the five ids; unknown keys stripped.
- Write = one `updateMany` limited to `id`, `status: 'ACTIVE'`, `role: 'CREATOR'` and an ACTIVE `creators` row (the same filter as the profile edit); count 0 → 401 `UNAUTHENTICATED`. Idempotent (full desired value). No audit row, no outbox.
- Validation happens in the contract schema, so the API and the screen share it; the DB column stays plain text (no CHECK) so the list can grow without a migration.
- `no-store` already applies to `/v1/creator*`.

## Dependencies

- No new packages. `Intl.DateTimeFormat` (`timeZoneName: 'shortOffset'`) for offsets and formatting (Node 24 and current WebViews support it).
- Prior stories: US-008 (creator module, `ProfileService` role scoping, `/settings` rows, `ProfileForm`/toast patterns).

## Risks

- **`UserProfileSchema` is strict and shared**: adding `timezone` changes login, `/me` and the edit responses. Update the fixtures and parsers in the same task (listed below).
- **Older WebViews without `shortOffset`**: fall back to computing the offset from `Intl.DateTimeFormat` parts (`longOffset`) and then to the IANA id only; never throw while rendering.
- **Offset shown at "today"**: DST-observing zones show the current offset; the chat times themselves are formatted with each message's own date, so history stays correct.
- **Sticky save bar vs keyboard** is not a factor (no text input on this screen).

## Tasks

### TASK-059: Timezone contract, `timezone` in the shared profile, `ProfileService.updateOwnTimezone`

Contracts (`packages/contracts/src/timezone.ts`, exported from `index.ts`):
```ts
export const CREATOR_TIMEZONE_PATH = '/v1/creator/timezone';
export const TIMEZONE_OPTIONS = [
  { id: 'Asia/Jakarta',      label: 'WIB · Jakarta' },
  { id: 'Asia/Makassar',     label: 'WITA · Makassar' },
  { id: 'Asia/Jayapura',     label: 'WIT · Jayapura' },
  { id: 'Asia/Singapore',    label: 'Singapura' },
  { id: 'Australia/Sydney',  label: 'Sydney' },
] as const;
export const TimezoneIdSchema = z.enum(TIMEZONE_OPTIONS.map(o => o.id) as [...]);
export const UpdateTimezoneRequestSchema = z.object({ timezone: TimezoneIdSchema }); // non-strict: other keys stripped
export function utcOffsetLabel(timezone: string, at: Date): string      // 'UTC+7', 'UTC+11', 'UTC+5:30'; '' when unknown
export function timezoneSummary(timezone: string, at = new Date()): string // 'WIB · Asia/Jakarta (UTC+7)' for the CrSettings row; raw id when not in the list
```
`UserProfileSchema` gains `timezone: z.string()`; `UpdateTimezoneResponseSchema = UserProfileSchema`.

backend-core:
- `toUserProfile` / `UserRow` return `timezone` (the column exists).
- `ProfileService.updateOwnTimezone(userId, timezone, role: 'USER' | 'CREATOR' = 'CREATOR'): Promise<UserProfile>` — the same active/role/creators-row filter as `updateOwnProfile` (extract the shared `where`), throws `ProfileAccountNotActiveError` on count 0.
- Decisions-log rows in `tech-stack.md` (1–4 above).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/timezone.ts` (+ `.spec.ts`) | list, schema, offset/summary helpers |
| MODIFY | `packages/contracts/src/user-auth.ts`, `user-auth.spec.ts`, `creator-settings.spec.ts`, `index.ts` | `timezone` field, export, fixtures |
| MODIFY | `packages/backend-core/src/user-auth/user-auth.service.ts` (+ int spec) | return `timezone` |
| MODIFY | `packages/backend-core/src/profile/profile.service.ts` (+ int spec) | `updateOwnTimezone`, shared filter |
| MODIFY | `.agile/guidelines/tech-stack.md` | decisions log |

**Testing:** schema accepts the five ids and rejects `UTC`, `Asia/Tokyo`, `''`, lowercase, `Asia/Jakarta ` and non-strings; unknown keys stripped. `utcOffsetLabel`: Jakarta `UTC+7` year-round; Sydney `UTC+11` on 2026-11-16 and `UTC+10` on 2026-07-01; unknown id → `''`. `timezoneSummary('Asia/Jakarta')` = `WIB · Asia/Jakarta (UTC+7)`; unknown id returns the raw id. Service int: a CREATOR's timezone changes and nothing else does (name, bio, role, photo); a USER row and another creator are untouched; blocked user / blocked creators row / missing creators row / role mismatch → `ProfileAccountNotActiveError` with nothing written; the same value twice is harmless; login and `/me` now return `timezone` (default `Asia/Jakarta`).

---

### TASK-060: `PATCH /v1/creator/timezone`

- In `apps/api/src/modules/creator/creator.controller.ts`: `@Patch('timezone') @HttpCode(200) @Roles('CREATOR')`, body via `ZodValidationPipe(UpdateTimezoneRequestSchema)`, calls `ProfileService.updateOwnTimezone(current.user.id, body.timezone, 'CREATOR')`, maps `ProfileAccountNotActiveError` to 401 `UNAUTHENTICATED`, returns the updated account.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/creator/creator.controller.ts` | route |
| CREATE | `apps/api/test/creator-timezone.int.spec.ts` | integration tests |
| MODIFY | `apps/api/test/profile.int.spec.ts`, `creator-settings.int.spec.ts` | `timezone` in profile responses |

**Testing:** each allowed id saves and shows in `/v1/me` and `/v1/creator/settings`; invalid values (`Asia/Tokyo`, `UTC`, `''`, `123`, `null`, missing body, `Asia/jakarta`) → 400 `VALIDATION_FAILED` and the stored value is unchanged; extra keys (`id`, `role`, `display_name`, `status`) ignored and no other column changes; IDOR (creator A cannot change creator B); USER → 403 `FORBIDDEN_ROLE` with nothing written; no token / garbage / admin token → 401; blocked account, blocked creators row and stale `session_version` → 401 and nothing written; same value twice is idempotent; `no-store`; the customer profile route and `/v1/creator/profile` still ignore `timezone`.

---

### TASK-061: `/settings/timezone` screen (`CrTimezone`), settings row, date helper

- Mini App client: `api.updateCreatorTimezone(timezone)`; `AuthProvider.updateTimezone` puts the saved account into the in-memory session (like `updateProfile`).
- `apps/miniapp/src/creator/CreatorTimezonePage.tsx` replaces the placeholder at `/settings/timezone` (outside the shell, `RequireRole CREATOR`). Header with back arrow to `/settings` and title "Zona waktu"; a radio list of the five options (label + `id · UTC±X` from `utcOffsetLabel`), the current one marked with the filled radio and a check; the "Apa yang berubah?" card (hourglass disc) with the verbatim text; sticky **Simpan Zona Waktu**. Selection is local until saved. States: saving (button disabled, `aria-busy`, single request on a double click), success (toast, placeholder wording "Zona waktu disimpan" because no board covers it), failure (banner/toast with placeholder copy, selection kept, retry works). Radios are a real `radiogroup` with keyboard support.
- `CrSettings` "Zona waktu" row shows `timezoneSummary(user.timezone)` as its hint (replaces the empty hint from US-008).
- `apps/miniapp/src/format/date-time.ts`: `formatDateTime(value: string | Date, timezone: string, options?)` and `formatTime(...)` using `Intl.DateTimeFormat('id-ID', { timeZone })`; an unknown or invalid timezone falls back to `Asia/Jakarta` instead of throwing. No screen consumes it yet (no times are shown anywhere), so it ships with tests only; later stories must use it with `useAuth().state.user.timezone`.
- Playwright visual item `miniapp-creator-timezone` (board `CrTimezone`, 390×844).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec), `AuthProvider.tsx`, `test/fake-miniapp-api.ts` | client call, provider method, fakes, `timezone` in fixtures |
| CREATE | `apps/miniapp/src/creator/CreatorTimezonePage.tsx`, `creator-timezone.module.css` (+ spec) | screen |
| MODIFY | `apps/miniapp/src/creator/CreatorSettingsPage.tsx` (+ spec), `creator-copy.ts` | row hint, placeholder copy |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `router.spec.tsx` | real `/settings/timezone` (remove it from `LATER_SETTINGS`) |
| CREATE | `apps/miniapp/src/format/date-time.ts` (+ spec) | display helper |
| MODIFY | `packages/ui/src/icons/index.tsx` (+ `RadioDot`/check only if not present), `visual/specs/visual.spec.ts` | icons, screenshot item |
| MODIFY | `.agile/guidelines/codebase-map.md` | endpoints, routes, inventory (at story completion) |

**Testing:** the list shows the five options with the current one marked; choosing another and saving sends `{timezone}` once and updates the `CrSettings` row (`WITA · Asia/Makassar (UTC+8)`); a double click sends one request; failure keeps the selection and allows retry; the back arrow returns to `/settings` without saving; a USER is redirected; keyboard arrows move the radio selection. `formatDateTime`: the same UTC instant renders as 07:00 / 08:00 / 09:00 in Jakarta / Makassar / Jayapura, a date-line case rolls the day correctly, Sydney follows DST, an invalid zone falls back to Asia/Jakarta, an invalid date does not throw. Visual: compare at 390 px with `CrTimezone.png`; the Sydney offset may differ from the PNG outside daylight saving (documented).
