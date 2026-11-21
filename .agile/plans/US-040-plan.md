# Technical Plan: US-040 — Creator sets the welcome message

## Architecture Overview

Agreed with the user (2026-11-21). A creator has **at most one** welcome message configuration: switch, text, optional media. Delivery is US-041.

- Storage: `creator_welcome_messages` (one row per creator, upsert). No version history; delivery reads the row current at delivery time (Resolved Conflict #5).
- API: `GET /v1/creator/welcome-message` and `PUT /v1/creator/welcome-message` (full replace of the saved state, so a retried save is idempotent).
- Media: **Pilih Galeri** = a `GALLERY` asset of mine with a gallery item (same asset, no copy); **Upload Baru** = a `WELCOME` asset uploaded through the existing init/PUT/complete flow (US-038 added the purpose), never in the gallery. The asset may be reused by every welcome message (many attachments, one object). Replacing or removing media only changes the reference; an orphaned `WELCOME` upload is removed by the cleanup loop (24 h), and cleanup never deletes an asset the config or any attachment references.
- `GET /v1/creator/settings` (US-008) gains `welcome_enabled: boolean` so the `CrSettings` row shows "Aktif" / "Mati" (placeholder "Mati", gap).
- UI reuses the `MediaPicker` extracted in US-038 TASK-226 and `useUploads`.

Brief refs: §8B, §8E; design-integration Resolved Conflict #5. Design refs: `CrWelcome`, `CrWelcomePick`, `CrWelcomeGallery`, `CrWelcomeUpload`, `CrSettings`.

## Authorization & Data Rules

- `@Roles('CREATOR')`; USER → 403 `FORBIDDEN_ROLE`; blocked creator → 401. The row is addressed by the session's creator, never by an id in the request.
- Asset check under `FOR UPDATE OF a` with `creator_id = mine` in the statement: another creator's asset, unknown or malformed id, a `CHAT` / `BROADCAST` asset, a `GALLERY` asset without a gallery item → one identical 404 `MEDIA_NOT_FOUND`; not READY → 409 `MEDIA_NOT_READY`.
- Validation: `enabled = true` requires a text of 1–2000 code points (trimmed); `enabled = false` may keep a draft text (or empty). DB CHECK `enabled = false OR body IS NOT NULL`.
- Strict body (unknown key → 400). Rate limit: reuse the creator-settings limiter (30 / min).
- Audit not required (creator's own setting, not an admin mutation).

## Dependencies

- US-038 (purposes `WELCOME`, `MediaPicker`, cleanup clause), US-032 (uploads), US-008 (creator settings page/endpoint). No new packages / env.

## Risks

- **Reusing one asset across many messages:** `message_attachments` has no unique on `asset_id`, confirmed; gallery reuse already works this way (US-036).
- **Switch on without prior text:** blocked by the validation, not the UI alone.
- **Settings row label for "off"** is undesigned → placeholder, listed in the report.

## Tasks

### TASK-240: Migration — `creator_welcome_messages`

`<next>_welcome_message` and `schema.prisma`: `creator_welcome_messages`: `creator_id uuid pk fk RESTRICT`, `enabled boolean not null default false`, `body text null` (CHECK `body IS NULL OR char_length(body) BETWEEN 1 AND 2000`; CHECK `enabled = false OR body IS NOT NULL`), `asset_id uuid null fk RESTRICT (media_assets)`, `updated_at timestamptz(3)`. Prisma model `CreatorWelcomeMessage` with relations on `Creator` and `MediaAsset`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/<ts>_welcome_message/migration.sql` | table + CHECKs |
| MODIFY | `packages/db/prisma/schema.prisma` | model |

**Testing:** migration applies; CHECKs reject `enabled` without body and an over-long body.

---

### TASK-241: Contracts and `WelcomeMessageService`

- `packages/contracts/src/welcome-message.ts`: `welcomeMessageResponse` `{enabled, body, media: {asset_id, kind: 'PHOTO'|'VIDEO', source: 'GALLERY'|'UPLOAD', duration_seconds, thumbnail_url} | null}`; `saveWelcomeMessageRequest` strict `{enabled: boolean, body: string, asset_id: uuid | null}` (body trimmed, ≤ 2000 code points, empty allowed only with `enabled: false`); `creatorSettingsResponse` (US-008) gains `welcome_enabled`.
- `packages/backend-core/src/welcome-message/welcome-message.service.ts`: `get(creatorUserId)` (defaults `{enabled:false, body:'', media:null}`; media view built like the chat attachments with signed thumbnail URL via `MediaAccessService`), `save(creatorUserId, input)` returning `{kind:'saved', ...} | 'invalid' | 'media_not_found' | 'media_not_ready' | 'not_found'`; one transaction (asset lock → upsert).
- Cleanup clause (US-038 TASK-223 deferred this): add `NOT EXISTS (SELECT 1 FROM creator_welcome_messages w WHERE w.asset_id = a.id)` to the unused-upload cleanup of `WELCOME` assets in `media-upload.service.ts`.
- `CreatorSettingsService` returns `welcome_enabled`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/welcome-message.ts` (+ spec) | schemas |
| MODIFY | `packages/contracts/src/creator-settings.ts`, `index.ts` | field, export |
| CREATE | `packages/backend-core/src/welcome-message/*` (+ int spec) | service |
| MODIFY | `packages/backend-core/src/media/media-upload.service.ts` | cleanup clause |
| MODIFY | `packages/backend-core/src/creator-settings/creator-settings.service.ts` | `welcome_enabled` |

**Testing (integration):** defaults; save text only, text + gallery asset, text + WELCOME upload; enabled with empty text → invalid; replace and remove media; another creator's asset / CHAT asset / BROADCAST asset / unknown id → `media_not_found`; PENDING asset → `media_not_ready`; save twice = same state; cleanup keeps a WELCOME asset referenced by the config and one attached to a message, deletes an unused 25 h old one; settings show `welcome_enabled`.

---

### TASK-242: API — welcome message endpoints

`apps/api/src/modules/creator/creator-welcome.controller.ts`: `GET` and `PUT /v1/creator/welcome-message`, `@Roles('CREATOR')`, `no-store`, Zod pipe, limiter, error mapping (`MEDIA_NOT_FOUND` 404, `MEDIA_NOT_READY` 409, validation 400). Register in `CreatorModule`; `roles-declared.spec.ts` passes.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creator/creator-welcome.controller.ts` (+ int spec) | endpoints |
| MODIFY | `apps/api/src/modules/creator/creator.module.ts`, `tokens.ts` | wiring |

**Testing (HTTP):** USER → 403; unauthenticated 401; blocked creator 401; PUT then GET round trip; IDOR asset 404 identical to unknown; unknown key 400; enabled without text 400.

---

### TASK-243: Mini App `/settings/welcome`

Replace the `NotImplemented` placeholder: boards `CrWelcome` (empty media), `CrWelcomePick` (picker, via `MediaPicker`), `CrWelcomeGallery`, `CrWelcomeUpload` (states of one route).
- `apps/miniapp/src/creator/welcome/`: `WelcomePage.tsx`, `useWelcome.ts` (load, local draft, save), `welcome-copy.ts` (strings verbatim), `welcome.module.css` (values from the HTML), spec.
- Controls: switch "Kirim pesan selamat datang" with its sub-line, "Isi pesan" textarea + the hint under it, "Media (opsional)" block (Pilih Galeri / Upload Baru → after choosing: "Hapus Media" / "Ganti Media" and the board's note per source), the live preview bubble ("Tampilan di chat pelanggan…", time sample "09.00"), the footnote, **Simpan Pesan** (disabled while saving or when switched on with empty text or an upload not READY).
- Upload Baru: `useUploads` with `purpose: 'WELCOME'` (progress / failure placeholders as US-036).
- Save: `PUT`; success → toast "Pesan selamat datang disimpan." (placeholder); failure → inline error, draft kept, retry works; Back with unsaved changes just leaves (no dialog on the board).
- `CrSettings` row "Pesan selamat datang · Terkirim otomatis ke subscriber baru" shows "Aktif" / "Mati" from `welcome_enabled` and links to `/settings/welcome`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/creator/welcome/*` | page, hook, copy, styles, spec |
| MODIFY | `apps/miniapp/src/creator/CreatorSettingsPage.tsx` (+ spec) | row state |
| MODIFY | router (`apps/miniapp/src/app`), API client | route, calls |

**Testing (component):** loads saved values; switch on with empty text keeps Simpan disabled; gallery pick shows the "same media" note; upload shows the "only in the welcome message" note; Hapus Media clears; save sends one PUT with the right body; failure keeps the draft; USER redirected away.

---

### TASK-244: Visual check and docs

Playwright at 390 × 1180 / 844 for `CrWelcome`, `CrWelcomePick`, `CrWelcomeGallery`, `CrWelcomeUpload`, and `CrSettings`; fix differences. `codebase-map.md` (table, endpoints, route), `design-integration.md` Known Gaps (save toast, "Mati" label, empty default text).

**Testing:** screenshots reviewed; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
