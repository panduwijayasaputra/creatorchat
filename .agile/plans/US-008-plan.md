# Technical Plan: US-008 — Creator settings, edit profile and bio link

## Architecture Overview

Vertical slice, agreed with the user (2026-11-16, all recommendations accepted):

1. **Contracts** — `creator-settings.ts` (settings response, creator profile update reuses `UpdateProfileRequestSchema`); `CreatorLinkResponseSchema` gains `bio`.
2. **DB** — **no migration.** A creator's public name, bio and photo are the same `users` columns US-007 edits (`display_name`, `bio`, `avatar_url`); the `creators` row keeps `public_code` and `status`.
3. **backend-core** — `ProfileService.updateOwnProfile` gets a `role` argument (CREATOR also requires an ACTIVE `creators` row); new `CreatorSettingsService.get(userId)`; `buildBioLink(botUsername, publicCode)`; `CreatorLinkService` also returns `bio`.
4. **API** — new `apps/api/src/modules/creator/`: `GET /v1/creator/settings`, `PATCH /v1/creator/profile`, both `@Roles('CREATOR')`. US-007's `PATCH /v1/me/profile` stays USER-only.
5. **Mini App** — extract a shared `ProfileForm` from US-007's `EditProfilePage`; `/settings` (`CrSettings`, inside the creator shell) and `/settings/profile` (`CrEditProfile` + `EditStates`, outside the shell).

Brief refs: §3, §4, §5, §10. Design refs: `CrSettings` (390×1700), `CrEditProfile` (390×960), `EditStates` (same four states, "Perubahan belum tersimpan"). Out of scope: persona, welcome message, price, timezone (US-009 / later phases), avatar upload (Phase D), creator category/city (no input designed).

### Decisions (record in `tech-stack.md` decisions log in TASK-054)

| # | Decision |
|---|---|
| 1 | Creator public profile = the `users` row. One edit path, no `creator_profiles` table. Category/city is a design gap: the "Preview profil" card shows name + bio only (no invented line). |
| 2 | Separate CREATOR endpoint (`PATCH /v1/creator/profile`), same Zod schema as US-007. The USER route and its 403 tests are unchanged. |
| 3 | The bio link is built **server-side**: `https://t.me/<TELEGRAM_BOT_USERNAME>?start=c_<public_code>` (the format US-005 accepts; the board's `?start=salsa` is illustrative). `bio_link: null` when the bot username is unset. |
| 4 | Rows for later stories (Persona AI, Pesan selamat datang, Harga subscription, Zona waktu) are tappable and open the "belum dibangun" placeholder; **no status chips** (the board's "Tersimpan"/"Aktif" are fake until those stories exist). |
| 5 | Shared `ProfileForm` for `/profile/edit` and `/settings/profile`. `AuthProvider.updateProfile` picks the endpoint from the signed-in role. |

## Authorization & Data Rules

- `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('CREATOR')` on both routes; USER → 403 `FORBIDDEN_ROLE`. `roles-declared.spec.ts` must still pass.
- No creator ID anywhere in the request. The creator row is found by `user_id = session user`. `public_code` is read-only and never accepted from the client; unknown body keys are stripped (non-strict schema).
- Write = one transaction: `user.updateMany({ where: { id, status: 'ACTIVE', role: 'CREATOR', creator: { status: 'ACTIVE' } } })`, then the optional `reset_avatar` raw update under the same row lock (as US-007). Count 0 → 401 `UNAUTHENTICATED` (same as a dead session; no account-state oracle). A role change or block racing the save cannot slip a write through.
- `GET /v1/creator/settings`: a BLOCKED creator is stopped by the guard; a CREATOR with no `creators` row, or a BLOCKED `creators` row, → 403 `FORBIDDEN`. Returns only the caller's data; `no-store`.
- Idempotent by construction (full desired values; same as US-007). No outbox, no audit row.
- `GET /v1/creators/by-code/:publicCode` additionally returns `bio` (nullable) so customers see the saved values; still one identical 404 for unknown/blocked. It stays `@Roles('USER')`.
- Bio link contains only the public code (public by design); no secrets. `TELEGRAM_BOT_USERNAME` is validated as `^[A-Za-z0-9_]{5,32}$` before it is put in a URL; otherwise `bio_link: null`.

## Dependencies

- No new packages. Clipboard: `navigator.clipboard.writeText` with a hidden-textarea `execCommand('copy')` fallback (Telegram WebViews can lack the async API).
- Env: none new (`TELEGRAM_BOT_USERNAME` exists; API side). Prior stories: US-005 (public code, link format), US-006 (roles), US-007 (schema, service, `Avatar`, `BottomToast`, edit page).

## Risks

- **Refactoring `EditProfilePage`** can regress US-007: its 14 tests must pass unchanged against the extracted `ProfileForm`.
- **Creator row missing for a CREATOR** (role set without a `creators` row): settings returns 403, UI shows the generic error; admin approval (US-012) creates both together.
- **Clipboard unavailable / denied**: fall back to `execCommand`; if that fails show the link text selected plus an error toast (no silent failure).
- **`CreatorLinkResponseSchema` is strict**: adding `bio` changes the response; update the Mini App parser and fixtures in the same task.
- **Toast copy** "Link disalin" and the "not configured" line are placeholder wording (design gap).

## Tasks

### TASK-054: Creator contracts, `ProfileService` role scoping, `CreatorSettingsService`

Contracts (`packages/contracts/src/creator-settings.ts`, exported from `index.ts`):
```ts
export const CREATOR_SETTINGS_PATH = '/v1/creator/settings';
export const CREATOR_PROFILE_PATH = '/v1/creator/profile';
export const CreatorSettingsResponseSchema = z.strictObject({
  profile: UserProfileSchema,            // the caller's own account (name, bio, avatar_url, telegram_*)
  public_code: z.string(),
  bio_link: z.string().url().nullable(), // https://t.me/<bot>?start=c_<code>, null when the bot username is unset
});
// PATCH body = UpdateProfileRequestSchema; response = UserProfileSchema (UpdateProfileResponseSchema)
```
`CreatorLinkResponseSchema` gains `bio: z.string().nullable()`.

backend-core:
- `ProfileService.updateOwnProfile(userId, input, role: 'USER' | 'CREATOR' = 'USER')`: `where` adds `role` and, for CREATOR, `creator: { status: 'ACTIVE' }`. Existing USER callers/tests unchanged.
- `creator-settings/creator-settings.service.ts`: `CreatorSettingsService.get(userId): Promise<{ profile; publicCode } | null>` (null when no ACTIVE creator row); `bio-link.ts`: `buildBioLink(botUsername: string | undefined, publicCode: string): string | null` (validates the username, `encodeURIComponent` free since the charset is fixed).
- `CreatorLinkService.resolve` selects and returns `bio`.
- Decisions-log rows in `tech-stack.md` (rows 1–3, 5 above).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-settings.ts` (+ `.spec.ts`) | settings schema and paths |
| MODIFY | `packages/contracts/src/creator-link.ts`, `creator-link.spec.ts`, `index.ts` | `bio` field, exports |
| MODIFY | `packages/backend-core/src/profile/profile.service.ts` (+ int spec) | role-scoped write |
| CREATE | `packages/backend-core/src/creator-settings/{creator-settings.service.ts,bio-link.ts,index.ts}` + specs | settings read, link builder |
| MODIFY | `packages/backend-core/src/creator-link/creator-link.service.ts` (+ int spec), `src/index.ts` | return `bio`, export |
| MODIFY | `.agile/guidelines/tech-stack.md` | decisions log |

**Testing:** contracts: strict schema rejects extra keys, `bio_link` null/url. `buildBioLink`: valid, undefined, empty, `Bad Name`, injection (`x&start=y`, `../`) → null. Service int: CREATOR with ACTIVE creator updates; USER row untouched by CREATOR call (and the reverse); BLOCKED user / BLOCKED creator row → `ProfileAccountNotActiveError`, nothing written; concurrent block-then-save leaves no write; `reset_avatar` works for CREATOR; `get` returns null for a CREATOR without creator row; by-code returns `bio`.

---

### TASK-055: Creator API — `GET /v1/creator/settings`, `PATCH /v1/creator/profile`

- `apps/api/src/modules/creator/creator.controller.ts`, `creator.module.ts`, `tokens.ts`; register in `AppModule`. Both routes `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('CREATOR')`, `Cache-Control: no-store`.
- `GET` → `CreatorSettingsResponseSchema` (`bio_link` from `ENV.TELEGRAM_BOT_USERNAME`); no creator row → 403 `FORBIDDEN`.
- `PATCH` (`@HttpCode(200)`, `ZodValidationPipe(UpdateProfileRequestSchema)`) → `ProfileService.updateOwnProfile(me.id, body, 'CREATOR')`; `ProfileAccountNotActiveError` → 401 `UNAUTHENTICATED`.
- `creators.controller.ts` by-code response includes `bio`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creator/{creator.controller.ts,creator.module.ts,tokens.ts}` | routes |
| MODIFY | `apps/api/src/app.module.ts`, `apps/api/src/modules/creators/creators.controller.ts` | wiring, `bio` |
| CREATE | `apps/api/test/creator-settings.int.spec.ts` | integration tests |
| MODIFY | `apps/api/test/creator-link*.int.spec.ts`, `roles-declared.spec.ts` if needed | `bio` in responses |

**Testing:** USER → 403 on both routes; no token / admin token → 401; blocked creator, stale `session_version` → 401; IDOR: body `id`/`user_id`/`public_code`/`role` ignored, creator A cannot change creator B (two creators, B unchanged); limits 40/160 and blank bio → null; `bio_link` equals `https://t.me/<bot>?start=c_<own code>` and `null` with the bot username unset; saved name/bio/photo appear in `GET /v1/creators/by-code/:code` as a USER; `reset_avatar`; `no-store`; CREATOR without a creators row → 403.

---

### TASK-056: Mini App client + shared `ProfileForm` (no visible change)

- `api-client.ts`: `getCreatorSettings()`, `updateCreatorProfile(input)` (reuse the single-flight 401 replay).
- `AuthProvider.updateProfile` calls the endpoint matching the current role and replaces the in-memory user.
- Extract `EditProfilePage` body into `profile/ProfileForm.tsx` with props `{ backTo: string; title: string }` (save goes through `useAuth().updateProfile`); `EditProfilePage` becomes a thin wrapper. CSS module moved/renamed with it, values unchanged.
- `test/fake-miniapp-api.ts`: creator settings + profile calls.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts`, `api-client.spec.ts`, `AuthProvider.tsx` | creator calls, role-based save |
| CREATE | `apps/miniapp/src/profile/ProfileForm.tsx` (+ css) | shared form |
| MODIFY | `apps/miniapp/src/profile/EditProfilePage.tsx`, `EditProfilePage.spec.tsx` | thin wrapper; tests unchanged |
| MODIFY | `apps/miniapp/test/fake-miniapp-api.ts` | fakes |

**Testing:** all existing US-007 miniapp tests pass untouched; provider calls the creator endpoint for a CREATOR and the user endpoint for a USER; 401 replay keeps the same body.

---

### TASK-057: `/settings` screen (`CrSettings`)

Page inside `CreatorShell` (route `/settings`, `RequireRole CREATOR` already via the shell). Loads `getCreatorSettings()` (loading + error + retry states, as the existing screens do). Sections per the board, values from `CrSettings.html`:
- Header: `Avatar`, name, `@username · dari Telegram`, chip "Creator · disetujui admin" (status = icon + label).
- "Preview profil" card: name + bio (no category/city line); **Edit Profil** → `/settings/profile`.
- "Link bio" card: `bio_link` shown without `https://`, **Salin Link Profil** (clipboard + `BottomToast` "Link disalin"); `bio_link === null` → "belum diatur" line and disabled button (placeholder copy in `creator-copy.ts`).
- "Persona, sambutan, harga, dan zona waktu": four rows → "belum dibangun" placeholder, no chips.
- "Akun dan bantuan": Akun Telegram (static text), Bantuan → bot link via the US-007 helper, hidden when unset.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/creator/CreatorSettingsPage.tsx`, `creator-settings.module.css`, `creator-copy.ts`, `copy-to-clipboard.ts` | screen, placeholder copy, clipboard helper |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `router.spec.tsx` | real `/settings`, `/settings/profile` |
| CREATE | `apps/miniapp/src/creator/CreatorSettingsPage.spec.tsx` | tests |

**Testing:** renders board copy; link shown and copied (clipboard stub + fallback path + failure toast); null link state; later rows navigate to the placeholder with no chips; a USER is redirected away; load failure + retry; no bottom-nav regressions (Pengaturan current).

---

### TASK-058: `/settings/profile` (`CrEditProfile` + `EditStates`) and visual check

- Route `/settings/profile` outside the shell, `RequireRole CREATOR`, rendering `ProfileForm` with `backTo="/settings"`, title "Edit Profil". Same states and rules as US-007.
- After saving, `/settings` and the preview show the new values (read from the provider's user / refetch).
- Playwright visual items `miniapp-creator-settings` (board `CrSettings`, 390×1700) and `miniapp-creator-edit-profile` (board `CrEditProfile`, 390×960); compare against the PNGs, record remaining differences.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/creator/CreatorEditProfilePage.tsx` (+ spec) | route wrapper |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | route |
| MODIFY | `visual/specs/visual.spec.ts`, `apps/miniapp/src/preview/Preview.tsx` if needed | screenshots |
| MODIFY | `.agile/guidelines/codebase-map.md` | endpoints, routes, inventory (done at story completion) |

**Testing:** the US-007 edit scenarios for a CREATOR (validation, saving, success toast, failure keeps input, double-click single request, Pakai Foto Telegram sends `reset_avatar` only on save); the back arrow returns to `/settings`; a USER opening `/settings/profile` is redirected; saved values are visible on `/settings`.
