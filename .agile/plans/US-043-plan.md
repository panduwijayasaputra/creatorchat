# Technical Plan: US-043 — Customer notification settings and per-creator mute

## Architecture Overview

Agreed with the user (2026-11-21): **backend and `/profile` switches now; the mute control UI stays blocked** until the designer places it (Known Gap, not invented).

- Tables come from US-042 TASK-231 (`notification_preferences`, `creator_mutes`). This story adds the service, the HTTP API and the two working switches on `/profile`.
- Preferences are **partial updates of independent columns**: `PATCH {messages_enabled?, show_content?}` writes only the given fields, so two quick toggles of different switches never overwrite each other, and repeated toggles of one switch end in the last value the server received. Mute is an idempotent `PUT` / `DELETE` of one row.
- No row means defaults (on / hidden / not muted); the first write upserts.
- `GET /v1/subscriptions` (US-025) gains `muted: boolean` per item so a future mute control needs no new call (additive, existing fields untouched).

Brief refs: §9 (mute per creator, hide preview default), §10. Design refs: `Profile` (Notifikasi section: "Notifikasi pesan", "Tampilkan isi pesan"); mute control: not designed — gap.

## Authorization & Data Rules

- `UserJwtGuard + RolesGuard + @Roles('USER')`: CREATOR → 403 `FORBIDDEN_ROLE`; blocked account → 401. Only the caller's own rows are ever read or written (user id from the session, never from the request).
- Mute: `PUT/DELETE /v1/creators/by-code/:publicCode/mute`. The creator must exist, be visible (not BLOCKED) **and** have a relation with the caller (a conversation row exists, i.e. any subscription ever): otherwise one identical 404 `CREATOR_NOT_FOUND` (unknown code, malformed code, no relation, blocked creator) — so the endpoint cannot be used to probe creators or store arbitrary rows.
- Body strict: unknown key → 400; empty `PATCH` → 400.
- No rate limit beyond the session (authenticated, cheap writes); Phase H adds global limits.
- Access notifications (US-044 / US-045) ignore these settings by design.

## Dependencies

- US-042 TASK-231 (tables), US-025 (`/v1/subscriptions`), US-007 (profile page). No new packages / env.

## Risks

- **`/profile` copy drift:** the existing switch labels in `ProfilePage.tsx` ("Tampilkan isi pesan di notifikasi") must match the board `Profile` ("Tampilkan isi pesan" + the sub-lines). Fix to the board in TASK-236 and say so in the report.
- **Mute UI blocked:** creators can already be muted by API only; documented, not shipped to users until design.

## Tasks

### TASK-234: Contracts and `NotificationPreferencesService`

- `packages/contracts/src/notification-preferences.ts`: `notificationPreferencesResponse` `{messages_enabled: boolean, show_content: boolean}`; `updateNotificationPreferencesRequest` (strict, at least one key); `muteResponse` `{muted: boolean}`; extend the subscriptions item schema with `muted`.
- `packages/backend-core/src/notification-preferences/notification-preferences.service.ts`: `get(userId)` (defaults when no row), `update(userId, patch)` (`INSERT … ON CONFLICT (user_id) DO UPDATE SET <only given columns>`), `mute(userId, publicCode)` / `unmute(userId, publicCode)` (relation check in the statement: creator by `public_code`, `status ACTIVE`, creator user ACTIVE, `EXISTS conversation(customer_id = $user, creator_id)`; `ON CONFLICT DO NOTHING` / `DELETE`; returns `'ok' | 'not_found'`).
- `SubscriptionsService` (US-025) adds `muted` via a left join on `creator_mutes`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/notification-preferences.ts` (+ spec) | schemas |
| MODIFY | `packages/contracts/src/…subscriptions….ts`, `index.ts` | `muted`, export |
| CREATE | `packages/backend-core/src/notification-preferences/*` (+ int spec) | service |
| MODIFY | backend-core subscriptions service (US-025) | `muted` |

**Testing (integration):** defaults without a row; patch one field leaves the other; two concurrent patches of different fields keep both; mute twice = one row, unmute twice fine; mute with a creator the user never had a conversation with / unknown / malformed / blocked creator → `not_found`, no row; user A cannot touch user B's rows (ids come from the session); `muted` appears in the subscriptions list.

---

### TASK-235: API — preferences and mute endpoints

- `apps/api/src/modules/notifications/notifications.controller.ts` + module: `GET /v1/me/notification-preferences`, `PATCH /v1/me/notification-preferences` (200 with the full new state), `PUT /v1/creators/by-code/:publicCode/mute` and `DELETE` (200 `{muted}`), all `no-store`, `@Roles('USER')`, Zod pipes, error mapping (`CREATOR_NOT_FOUND` 404). Register in `AppModule`.
- `roles-declared.spec.ts` passes.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/notifications/notifications.controller.ts`, `notifications.module.ts` (+ int spec) | endpoints |
| MODIFY | `apps/api/src/app.module.ts` | register |

**Testing (HTTP):** CREATOR → 403; blocked → 401; unauthenticated → 401; PATCH `{}` → 400, unknown key → 400; mute IDOR cases → identical 404; PATCH then GET round trip.

---

### TASK-236: Mini App Notifikasi switches, visual check and docs

- `ProfilePage.tsx`: the two disabled `Switch` rows become working controls fed by `GET /v1/me/notification-preferences` (loading: switches disabled; load failure: keep disabled with the page's existing error pattern). Toggle = optimistic change, `PATCH` with only the changed field, on failure revert + dark toast (placeholder copy "Pengaturan belum tersimpan." — gap), rapid taps serialised per switch (last tap wins). Labels and helper lines exactly as board `Profile`: "Notifikasi pesan" / "Kabar saat creator membalas.", "Tampilkan isi pesan" / "Mati secara default. Isi pesan disembunyikan.".
- Typed client `getNotificationPreferences` / `updateNotificationPreferences`; no mute UI.
- Playwright check of `Profile` at 390 × (board height); docs (`codebase-map.md` endpoints; `design-integration.md` Known Gaps: mute control still not designed, so API exists without UI).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/profile/ProfilePage.tsx`, `ProfilePage.spec.tsx`, `profile-copy.ts` | working switches |
| CREATE | `apps/miniapp/src/profile/useNotificationPreferences.ts` | hook |
| MODIFY | miniapp API client | calls |
| MODIFY | `.agile/guidelines/codebase-map.md`, `design-integration.md` | docs |

**Testing (component):** initial values from the server; toggling sends one PATCH with one key; failure reverts and shows the toast; two quick toggles of different switches both persist; ProfileBlocked / ProfilePending variants unaffected; screenshot compared with `Profile.png`.

---

## Not planned (blocked)

- **Mute control UI** — no board places the "Bisukan" switch (candidates: the chat "Opsi percakapan" menu or the Langganan card). Plan a task once the designer decides. The backend (TASK-234/235) is ready for it, including `muted` on `/v1/subscriptions`.
