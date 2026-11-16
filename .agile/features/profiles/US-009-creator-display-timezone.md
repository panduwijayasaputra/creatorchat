# US-009: Creator display timezone

**Status:** ready_for_uat
**Priority:** low
**Feature:** profiles
**Phase:** B
**Roles:** CREATOR
**Brief refs:** §13 (UTC storage, IANA timezone for display)
**Design refs:** `CrTimezone`, `CrSettings` ("Zona waktu" row). Resolved conflict #6 in `design-integration.md`

## Description

As a CREATOR, I want to choose the timezone my times are shown in, so that message and access times match where I live.

## Acceptance Criteria

- [ ] `/settings/timezone` renders `CrTimezone` 1:1 with the options shown there; the current choice is marked and the `CrSettings` row shows it (e.g. "WIB · Asia/Jakarta (UTC+7)"). Default for a new account is `Asia/Jakarta`.
- [ ] The server accepts only valid IANA timezone names from the allowed list; anything else returns 400 with a validation error and nothing changes.
- [ ] The setting changes display only: stored timestamps stay UTC, and no existing data is rewritten. Dates shown in the creator's Mini App use the saved timezone from then on.
- [ ] Only the caller's own account can be changed (`@Roles('CREATOR')`, no user ID from the client); USER gets 403, blocked/stale sessions are rejected.
- [ ] Save failure keeps the selection and shows an error; screenshot at 390 px matches `CrTimezone`.

## Tasks

### TASK-059: Timezone contract, `timezone` in the shared profile, `ProfileService.updateOwnTimezone`
**Status:** done

### TASK-060: `PATCH /v1/creator/timezone`
**Status:** done

### TASK-061: `/settings/timezone` screen (`CrTimezone`), settings row, date helper
**Status:** done
