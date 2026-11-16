# Technical Plan: US-007 — USER profile page and edit profile

## Architecture Overview

Vertical slice, agreed with the user (2026-11-16, "go with recommendations"):

1. **Contracts** — `profile.ts` (update request/response); `UserProfileSchema` gains `bio` and `telegram_avatar_url`.
2. **DB** — one migration: `users.telegram_avatar_url`.
3. **backend-core** — `ProfileService.updateOwnProfile`.
4. **API** — `PATCH /v1/me/profile`, USER only.
5. **Mini App** — `/profile` (inside the customer shell) and `/profile/edit` (outside the shell, own header + sticky save bar).

Brief refs: §3, §5, §10, §15. Design refs: `Profile`, `EditProfile`, `EditStates` (4 states: Menyimpan / Validasi / Berhasil / Gagal, isian dipertahankan). Out of scope: `ProfilePending|Rejected|Blocked` (US-010/011), avatar upload (Phase D), creator profile edit (US-008).

### Decisions (recorded in `tech-stack.md` decisions log by TASK-048)

| # | Decision |
|---|---|
| 1 | **Pakai Foto Telegram** only changes the form preview; **Simpan Perubahan** sends `reset_avatar: true` in the same PATCH (atomic). Needs `users.telegram_avatar_url`, refreshed on every login (login never overwrites `avatar_url`). Reset sets `avatar_url = telegram_avatar_url`. |
| 2 | Unknown body keys (`id`, `role`, `telegram_id`, `username`, `status`, ...) are **stripped and ignored** (plain `z.object`, not `strictObject`). |
| 3 | **No TanStack Query** in this story. The profile is the session's `/me` in `AuthProvider`; the API client gets `updateProfile()` and the result is pushed into the in-memory user. TanStack arrives with the first real list/server-state screen. |
| 4 | Notifikasi switches render **disabled**, in the designed default state, persisting nothing (Phase E). |
| 5 | Placeholder copy (design gaps, one constants file): "Ganti Foto" toast, "Kebijakan Privasi" tap, **Ajukan Jadi Creator** → `/profile/creator-request` showing `NotImplemented` until US-010. |

## Authorization & Data Rules

- Role `USER` only: `@UseGuards(UserJwtGuard, RolesGuard)` + `@Roles('USER')`. CREATOR → 403 `FORBIDDEN_ROLE` (creator profile = US-008). `apps/api/test/roles-declared.spec.ts` must still pass.
- Identity from the session only. The route has no ID. Fields in the body other than `display_name`, `bio`, `reset_avatar` are dropped by the schema.
- The write is a single `updateMany({ where: { id: me.id, status: 'ACTIVE' }, data })`; count 0 → treat as 403 `ACCOUNT_BLOCKED`/session rejection. This closes the race with a concurrent block. The guard already rejects BLOCKED accounts and stale `session_version`.
- Idempotent by construction: PATCH carries the full desired values, saving the same values twice yields the same row. No idempotency key, no extra locking, no outbox event, no audit row (a self-service profile edit; not an admin/security action).
- Validation (shared Zod schema, same on client and server): `display_name` trimmed, 1–40 code points, no control characters/newlines; `bio` trimmed, ≤ 160 code points, newlines allowed but control chars rejected, empty → `null`. Counting with `Array.from(s).length` on both sides.
- Text is stored plain and rendered as text only (React default; no `dangerouslySetInnerHTML`).
- Responses `Cache-Control: no-store`. Error shape `{code, message, request_id}`; validation failure → 400 `VALIDATION_ERROR` with field details (use the existing code from `errors.ts`).
- `avatar_url` and `telegram_avatar_url` are https-only (reuse `avatarOf` from `user-auth.service.ts`).

## Dependencies

- No new packages. Zod 4.6.7, NestJS 12.5.0, Prisma 7.10.1, React Router 8.5.1 already pinned.
- Env: none new. Hubungi Admin reuses `VITE_TELEGRAM_BOT_USERNAME` and the bot-link helper in `apps/miniapp/src/telegram/webapp.ts` (hidden/disabled when unset).
- Prior stories: US-004 (login/`/me`), US-006 (roles).

## Risks

- **Existing rows have no `telegram_avatar_url`** → migration backfills it from `avatar_url` (only unchanged until now, so it equals the Telegram photo at signup). A user whose Telegram photo changed gets the new value on next login.
- **Telegram photo URLs expire/rotate** (hot-linked, decided in US-004). Mitigation: refreshed each login; R2 copy deferred to Phase D. Avatar must fall back to the illustration when the image fails to load.
- **`UserProfileSchema` is shared with login and is strict**: adding fields changes both responses; update the Mini App parsers and every fixture/test that builds a profile in the same task.
- **Code-point vs grapheme counting**: emoji with joiners count as several. Accepted; the same function on both sides keeps the counter honest.
- **Sticky save bar vs virtual keyboard** in Telegram: test the layout at mobile heights.

## Tasks

### TASK-048: Profile contracts, `telegram_avatar_url` migration, decisions log

Contracts (`packages/contracts/src/profile.ts`, exported from `index.ts`):
```ts
export const DISPLAY_NAME_MAX = 40; export const BIO_MAX = 160;
export const UpdateProfileRequestSchema = z.object({   // non-strict: unknown keys are stripped
  display_name: z.string().transform(trim).pipe(z.string().refine(cp>=1 && cp<=40).refine(noControlChars)),
  bio: z.string().transform(trim).pipe(z.string().refine(cp<=160).refine(noControlCharsExceptNewline)).transform(v => v === '' ? null : v).nullable().optional(), // omitted/null/'' => null
  reset_avatar: z.boolean().optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export const UpdateProfileResponseSchema = UserProfileSchema; export const PROFILE_PATH = '/v1/me/profile';
```
`UserProfileSchema` (in `user-auth.ts`): add `bio: z.string().nullable()` and `telegram_avatar_url: z.string().nullable()`.

DB: `users.telegram_avatar_url TEXT NULL` (`telegramAvatarUrl String? @map("telegram_avatar_url")`); migration backfills `UPDATE users SET telegram_avatar_url = avatar_url`. Optional CHECK `bio` length ≤ 160 and `display_name` length 1–40 (raw SQL, `char_length`).

`UserAuthService`: on every login set `telegramAvatarUrl = avatarOf(photoUrl)` (create sets both); map `bio` and `telegram_avatar_url` in `toUserProfile`. Update seed fixtures to fill the column.

Decisions log: add rows for decisions 1–5 above.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/profile.ts` | Update schemas, limits, path |
| CREATE | `packages/contracts/src/profile.spec.ts` | Trim, limits (40/160 boundaries, 41/161 rejected), empty name rejected, empty bio → null, control chars rejected, unknown keys stripped, emoji code points |
| MODIFY | `packages/contracts/src/user-auth.ts` | `bio`, `telegram_avatar_url` on `UserProfileSchema` |
| MODIFY | `packages/contracts/src/index.ts` | Export profile |
| MODIFY | `packages/db/prisma/schema.prisma` | `telegramAvatarUrl` |
| CREATE | `packages/db/prisma/migrations/<ts>_user_telegram_avatar/migration.sql` | Column + backfill + CHECKs |
| MODIFY | `packages/db/seed/*` | Fixture value |
| MODIFY | `packages/backend-core/src/user-auth/user-auth.service.ts` | Write on login, map new fields |
| MODIFY | `.agile/guidelines/tech-stack.md` | Decisions log |

**Testing:**
- Contract unit tests above. Integration: second login with a different Telegram photo updates `telegram_avatar_url` but not `avatar_url` / `display_name` / `bio`; first login sets both; migration leaves existing rows consistent. Existing login/`/me` tests updated for the two new fields.

---

### TASK-049: `ProfileService.updateOwnProfile` in backend-core

```ts
class ProfileService {
  constructor(private readonly prisma: PrismaClient) {}
  /** Throws ProfileError('ACCOUNT_NOT_ACTIVE') when no ACTIVE row matched. Returns the contract UserProfile. */
  updateOwnProfile(userId: string, input: UpdateProfileRequest): Promise<UserProfile>
}
```
One transaction: `updateMany({where:{id:userId,status:'ACTIVE'}, data:{displayName, bio, ...(reset_avatar ? {avatarUrl: <telegramAvatarUrl>} : {})}})`. For reset, the value comes from the row itself: do it as a read in the same tx (`findFirst` ACTIVE → `update`), or `$executeRaw` with `avatar_url = telegram_avatar_url`; pick the raw single statement to stay atomic. Re-read the row and map to `UserProfile`. Never touches role, status, telegram fields or `session_version`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/profile/profile.service.ts` | Service |
| CREATE | `packages/backend-core/src/profile/profile.service.int.spec.ts` | Integration tests (test DB) |
| MODIFY | `packages/backend-core/src/index.ts` | Export |

**Testing:**
- Updates name and bio; bio `''` → null; same values twice → identical row and `updated_at` change is harmless; `reset_avatar` copies `telegram_avatar_url` (and sets `null` when it is null); without `reset_avatar` avatar untouched; BLOCKED user → error and row unchanged; role/status/telegram_username never changed; other users' rows untouched; concurrent block + save → no write after block.

---

### TASK-050: `PATCH /v1/me/profile` endpoint

`apps/api/src/modules/me/me.controller.ts`: `@Patch('profile') @Roles('USER') @HttpCode(200)`, body through `ZodValidationPipe(UpdateProfileRequestSchema)`, calls `ProfileService` (provided in `MeModule`), returns `UserProfile`. `no-store` header. Map `ACCOUNT_NOT_ACTIVE` to the same error the guard uses for blocked accounts. `/v1/me` GET now returns `bio` and `telegram_avatar_url` (via the guard's loaded user → update `AuthenticatedUser` mapping).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/api/src/modules/me/me.controller.ts` | PATCH route |
| MODIFY | `apps/api/src/modules/me/me.module.ts` | Provide `ProfileService` |
| MODIFY | `apps/api/src/common/auth/user-jwt.guard.ts` (and `AuthenticatedUser` in backend-core) | Carry the new profile fields |
| CREATE | `apps/api/test/profile.int.spec.ts` | Endpoint integration tests |

**Testing (integration, `buildTestApp()`):**
- 200 with trimmed values; 400 on empty/41-char name and 161-char bio (boundaries 40/160 accepted); body with `id`, `role: 'CREATOR'`, `telegram_id`, `username`, `status: 'BLOCKED'` → 200 and none applied; two users, each only changes self (no way to address another); CREATOR token → 403 `FORBIDDEN_ROLE`; BLOCKED account and stale `session_version` → rejected, no write; no/invalid token → 401; admin token → 401; HTML-looking input stored verbatim as text; same request twice → 200 both; response never contains `telegram_avatar_url` of others (own only); `roles-declared.spec.ts` passes.

---

### TASK-051: Mini App API client, profile state, shared Avatar and Switch

- `MiniappApi.updateProfile(input: UpdateProfileRequest): Promise<UserProfile>` (`PATCH`, same 401 → single-flight re-exchange + retry path as the other calls; extend `authorized()` to carry a body). Result parsed with `UpdateProfileResponseSchema`. `me()`/login parse the new fields.
- `AuthProvider`: expose `updateProfile(input)` that calls the client and replaces the in-memory user on success (so `/profile` and the header reflect it without a refetch). Errors (`ApiError` / `NetworkError`) are rethrown to the screen.
- `packages/ui`: `Avatar` (size, `src`, falls back to the illustration from `Profile.html` when null or `onError`; image rendered as `<img>`, text alt = display name) and `Switch` (`role="switch"`, `disabled` supported; visual from `Profile.html` Notifikasi rows). Both presentational; add to `/__preview` with `data-preview-section`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts` | `updateProfile`, body support |
| MODIFY | `apps/miniapp/src/auth/AuthProvider.tsx` | `updateProfile` in context |
| MODIFY | `apps/miniapp/src/auth/api-client.spec.ts` | Client tests |
| CREATE | `packages/ui/src/components/avatar/Avatar.tsx` (+ `.module.css`, `.spec.tsx`) | Avatar |
| CREATE | `packages/ui/src/components/switch/Switch.tsx` (+ `.module.css`, `.spec.tsx`) | Switch |
| MODIFY | `packages/ui/src/index.ts`, `apps/miniapp/src/preview/Preview.tsx`, `fixtures.ts` | Export + preview |

**Testing:**
- Client sends Bearer + JSON body, parses response, renews once on 401 and retries with the same body, surfaces `ApiError`/`NetworkError`. Provider updates the in-memory user on success and leaves it untouched on failure. Avatar fallback on missing/broken image; Switch disabled is not toggleable and exposes `aria-checked`.

---

### TASK-052: `/profile` screen (`Profile`)

Route `/profile` stays inside `CustomerShell` (replaces the placeholder). Content from `Profile.png`/`Profile.html`, copy verbatim: profile card (Avatar, display name, `@telegram_username` when set, "Dari Telegram, tidak bisa diubah", **Edit Profil** → `/profile/edit`); "Ingin menjadi creator?" card with **Ajukan Jadi Creator** → `/profile/creator-request` (new route, `NotImplemented` until US-010, still `RequireRole USER`); Notifikasi section ("Notifikasi pesan", "Tampilkan isi pesan") with **disabled** `Switch`es in the designed state; Privasi card with **Kebijakan Privasi** (gap: placeholder toast); Bantuan card with **Hubungi Admin** (opens the bot via the existing bot-link helper and `VITE_TELEGRAM_BOT_USERNAME`; hidden/disabled with no crash when unset). Placeholder strings live in one constants file (`profile-copy.ts`) and are flagged as gaps. Buttons `nowrap`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/profile/ProfilePage.tsx` (+ `.module.css`) | Screen |
| CREATE | `apps/miniapp/src/profile/profile-copy.ts` | Placeholder copy constants (gaps) |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | Real `/profile`, `/profile/creator-request`, `/profile/edit` routes |
| CREATE | `apps/miniapp/src/profile/ProfilePage.spec.tsx` | Component tests |

**Testing:**
- Renders name/username/avatar fallback; no `@` line when username is null; Edit navigates; Ajukan navigates; switches disabled; placeholder toast on Kebijakan Privasi; Hubungi Admin link when bot username set and absent when not; a CREATOR visiting `/profile` is redirected to `/inbox`. Playwright screenshot at 390 px compared with `Profile.png` (review the sheet).

---

### TASK-053: `/profile/edit` screen with `EditStates` and visual check

Route `/profile/edit`: under `RequireRole USER`, **outside** the shell (own header "Edit Profil" with back chevron to `/profile`, sticky bottom save bar). Fields per `EditProfile.html`: **Nama tampil** (helper "Awalnya dari nama Telegram. Maksimal 40 karakter."), **Bio singkat (opsional)** (placeholder "Ceritakan dirimu secara singkat", live `n/160` counter, textarea `maxLength` not enforced silently: counter and inline error instead), read-only **Username Telegram** with lock icon, info note. Photo block: **Ganti Foto** → placeholder toast (nothing uploaded), **Pakai Foto Telegram** → sets the form preview to `telegram_avatar_url` (button disabled/inert when there is none) and marks `reset_avatar` for the save.

States (same route, same board `EditStates`):
1. **Menyimpan** — button disabled, `aria-busy`, "Menyimpan…", form dimmed (opacity .55, no interaction); no double submit.
2. **Validasi** — client validation with the shared schema before sending; red border + "Nama tampil wajib diisi." (and a bio length message in the same style; copy for the bio overflow is a minor gap: reuse "Bio maksimal 160 karakter." as placeholder).
3. **Berhasil** — toast "Perubahan disimpan" (dark toast above the save bar), the in-memory profile updated, stays on the page.
4. **Gagal** — `NetworkError`/5xx → red banner "Perubahan belum tersimpan" / "Koneksi terputus. Isianmu masih ada di sini. Coba simpan lagi." with all typed input kept. A 403 blocked/expired session is handled by the existing session-loss flow (sign-in/blocked panel), not this banner; a 400 maps server field errors inline.

Telegram `BackButton` wired to router back is already the app pattern; use it if the wrapper exposes it, otherwise the header chevron only (do not extend the wrapper beyond need).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/profile/EditProfilePage.tsx` (+ `.module.css`) | Screen and states |
| CREATE | `apps/miniapp/src/profile/EditProfilePage.spec.tsx` | Component tests |
| MODIFY | `visual/` specs | Playwright screenshots `/profile`, `/profile/edit` and the four states vs `Profile`, `EditProfile`, `EditStates` |
| MODIFY | `.agile/guidelines/codebase-map.md` | Route, endpoint, entity column, board inventory |

**Testing:**
- Required name blocks submit and shows the inline message; 40/41 and 160/161 boundaries; counter updates; whitespace-only name invalid; success calls `updateProfile` with trimmed values and shows the toast; saving twice is harmless; in-flight disables the button (single request on double click); network failure keeps typed values and shows the banner, retry succeeds; `reset_avatar` sent only after Pakai Foto Telegram; Ganti Foto uploads nothing (no network call); blocked response goes to the session-loss flow. Review the screenshots against the PNGs at 390 px, including the keyboard-open layout.

---
