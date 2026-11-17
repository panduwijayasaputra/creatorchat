# Technical Plan: US-032 — Creator gallery: upload photos and videos

## Architecture Overview

Vertical slice: env + storage port (backend-core) → contracts (`media.ts`) → migration (`media_assets`, `gallery_items`) → `MediaUploadService` / `MediaAccessService` (backend-core) → API (creator upload + gallery endpoints, dev-only local storage routes) → worker `media` queue (verify, strip location, thumbnail/poster, commit READY + gallery item) and cleanup loop → shared `GalleryTile` (packages/ui) → Mini App `/gallery`.

```
Mini App ── POST /v1/creator/media/uploads ─────────▶ API: validate type/size, rate limit,
                                                       media_assets (PENDING) ◀─ presigned PUT (15 min)
Mini App ── XHR PUT (progress %) ───────────────────▶ storage (local disk driver | R2)
Mini App ── POST /v1/creator/media/uploads/:id/complete ▶ API: HEAD size + magic-byte sniff
                                                       ok  → PROCESSING + outbox media.uploaded (one tx)
                                                       bad → FAILED, object deleted
worker: OutboxDispatcher(media.uploaded) → BullMQ "media" → MediaProcessor:
        download → sharp / ffprobe full check → strip location metadata → replace original
        → thumbnail/poster (480 px webp) → tx: READY + gallery_items (seq) 
Mini App ── GET /v1/creator/media/:id (poll 2 s) ───▶ READY → "Baru" tile + toast
Mini App ── GET /v1/creator/gallery ───────────────▶ READY items, newest first, signed thumbnail URLs
worker: cleanup loop (10 min) → PENDING > 24 h and FAILED rows + their objects
```

Brief refs: §8A, §8D, §8E, §13 (`MediaAsset`, `GalleryItem`), §15 (rate-limit uploads, no public bucket, no secrets in VITE), §17 (upload errors recover without orphan leaks; no production R2 in tests). Design refs: `CrGallery`, `CrGalleryUploading` (without the "DEMO · bukan fitur produk" strip), `CrGalleryDone`, `CrStatesGallery`, `CrMain` (tile states), `AdmSetMedia` (limit values).

Decisions agreed with the user (2026-11-17 / 2026-11-18):

| Topic | Decision |
|---|---|
| Dev/test storage | `STORAGE_DRIVER=local` (default): `LocalDiskStorage` keeps files under `STORAGE_LOCAL_DIR` and the API serves HMAC-signed, short-lived PUT/GET URLs at `/v1/dev-storage/*`. Refused when `NODE_ENV=production`. `R2Storage` (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) behind the same port, used with `STORAGE_DRIVER=r2` once a dev bucket exists. Tests use the local driver in a temp dir |
| Accepted formats | Photo: JPEG, PNG, WebP. Video: MP4 and MOV containers with H.264 or HEVC video. No HEIC (sharp's prebuilt binaries cannot decode it; the Telegram/iOS picker hands over JPEG for `image/*`). No transcoding |
| Limits | Photo ≤ 10 MB (10 485 760 B), video ≤ 200 MB (209 715 200 B), video ≤ 300 s. Env config (`MEDIA_MAX_PHOTO_BYTES`, `MEDIA_MAX_VIDEO_BYTES`, `MEDIA_MAX_VIDEO_SECONDS`); the Phase G admin screen replaces the env source later |
| Location metadata | Removed by the worker before READY: photos re-encoded with sharp (auto-orient, no metadata; JPEG q90 / PNG / WebP q90), videos remuxed `ffmpeg -map_metadata -1 -c copy` (no quality loss). The cleaned file overwrites the original object; stored size = cleaned size |
| Media number | `gallery_items.seq` per creator from `creators.last_gallery_seq` (incremented under the creator row lock when an item is added). Shown as "Media #N" in admin (US-035). Gallery items are never deleted, so numbers are stable |
| Uploads per tap | One file per Upload tap (single uploading tile on the board) |

Defaults applied (flag if you disagree):

- **Upload id:** the client generates `client_upload_id` (uuid). UNIQUE `(creator_id, client_upload_id)`: a repeated `init` for a PENDING asset returns the same asset with a fresh presigned URL; for any other state it returns the asset as it is (no URL).
- **Gallery item written at READY**, not at `complete`: a file that fails processing never reaches the gallery. Purpose is fixed at `init` (`GALLERY` now; US-036 adds `CHAT`).
- **Status polling:** the Mini App polls `GET /v1/creator/media/:id` every 2 s while PROCESSING (max 5 min, then the tile shows the failure). `// shortcut: polling, switch to a realtime media.updated event if processing gets slow`.
- **Signed URL lifetimes:** upload PUT 15 min; thumbnails in lists 15 min; originals (US-033+) 5 min.
- **Rate limit:** 30 `init` calls per creator per 10 min (`FixedWindowLimiter`, prefix `media:init`, fail closed 503). 429 `MEDIA_RATE_LIMITED`.
- **ffmpeg/ffprobe:** system binaries (`FFMPEG_PATH` / `FFPROBE_PATH`, default `ffmpeg` / `ffprobe`; Homebrew on this machine). The worker checks `ffprobe -version` at boot; missing → the media processor is not registered and events wait (logged once), like the Telegram pipeline without a token.
- **No seed media.** Visual checks use fixtures in the fake API.

## Authorization & Data Rules

- All endpoints: `UserJwtGuard` + `RolesGuard` + `@Roles('CREATOR')`. The creator is resolved from the session (`creators.user_id = me`); a missing creator row → 403 `FORBIDDEN_ROLE`. A blocked creator account is already 401 via the guard; a BLOCKED `creators.status` → 403 `CREATOR_NOT_ACTIVE` on `init` (no new uploads).
- Every asset lookup is scoped: `WHERE id = $1 AND creator_id = <mine>`. Unknown, malformed or another creator's id → the same 404 `MEDIA_NOT_FOUND`.
- Object keys are server-generated: `m/<creator_id>/<asset_id>` (original) and `m/<creator_id>/<asset_id>/thumb.webp`. Never returned by any endpoint, never accepted from the client. The asset id in the key is a uuid, not guessable.
- Signed URLs are issued only by `MediaAccessService` after an ownership check (US-032: owner only). US-033–037 add the subscriber, recipient and admin paths to the same service (backend.md rule 6).
- `complete` is idempotent: PROCESSING / READY / FAILED → return the current view, no second outbox event (dedupe key `media:<asset_id>:uploaded`).
- `complete` row-locks the asset (`FOR UPDATE`) so two concurrent completes cannot both write the outbox event.
- Worker commit: one transaction, lock the asset row, skip unless state = PROCESSING; lock the creator row; `last_gallery_seq + 1`; insert `gallery_items` `ON CONFLICT (creator_id, asset_id) DO NOTHING`; set READY with verified metadata. Run twice → no second item.
- Cleanup never touches READY assets (only READY can be referenced by gallery or messages), so a referenced object is never deleted.
- DB CHECKs: `state = 'READY'` ⇒ `mime`, `size_bytes`, `thumb_key` NOT NULL; `kind = 'VIDEO' AND state = 'READY'` ⇒ `duration_ms` NOT NULL; `declared_bytes > 0`.

## Dependencies

- New packages (check the npm registry and official docs at install, pin exactly, record in `tech-stack.md` "Pinned Versions", ≥ 2 weeks old):
  - `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (backend-core, R2 adapter; R2 docs: S3 API compatibility, presigned URLs).
  - `sharp` (apps/worker; prebuilt binaries, approve its build script in `pnpm-workspace.yaml` if needed).
- System: `ffmpeg` / `ffprobe` on PATH (README step: `brew install ffmpeg`).
- Env (new, server-only): `STORAGE_DRIVER` (`local`|`r2`, default `local`), `STORAGE_LOCAL_DIR` (default `.data/media`, git-ignored), `STORAGE_LOCAL_SIGNING_SECRET` (≥ 32 chars, required when driver = local), `MEDIA_MAX_PHOTO_BYTES`, `MEDIA_MAX_VIDEO_BYTES`, `MEDIA_MAX_VIDEO_SECONDS`, `FFMPEG_PATH`, `FFPROBE_PATH`. Existing: `R2_*`, `API_PUBLIC_URL` (local signed URL base; fallback `http://localhost:${API_PORT}`), `ALLOWED_ORIGINS` (CORS for the PUT).
- Prior stories: US-008 (creator settings module), US-013 (outbox dispatcher + worker loops), US-031 (worker structure).

## Risks

- **File input and XHR upload inside Telegram WebViews** (iOS/Android) are untested on devices → test in the browser harness now, flag for Phase H device QA.
- **HEVC playback** fails on some Android WebViews → accepted (no transcoding); noted in the decisions log.
- **200 MB PUT through the API in local mode** → the dev-storage PUT route streams to disk (no buffering) with its own body limit = the signed length; the global `BODY_LIMIT_BYTES` stays unchanged for every other route.
- **Video seeking needs HTTP Range** (Safari/iOS will not play without it) → dev-storage GET supports single `Range: bytes=` requests (206). R2 supports Range natively.
- **R2 CORS**: presigned PUT from the Mini App origin needs a bucket CORS rule → README section (user action when switching to R2).
- **Re-encoding photos** loses a little quality → q90; accepted with the location-removal decision.
- **Disk usage in dev** → `.data/` is git-ignored; cleanup loop removes failed/abandoned files.

## Tasks

### TASK-187: Storage port, env and local/R2 adapters

Backend-core `media/storage/`:

```ts
export interface PresignedPut { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: Date }
export interface ObjectStorage {
  presignPut(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<PresignedPut>;
  presignGet(key: string, opts: { expiresInSeconds: number; contentType?: string }): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  readRange(key: string, start: number, endInclusive: number): Promise<Buffer>;
  download(key: string, destinationPath: string): Promise<void>;
  upload(key: string, sourcePath: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>; // missing object = success
}
export function createObjectStorage(env: ServerEnv): ObjectStorage;
```

- `LocalDiskStorage(rootDir, signingSecret, publicBaseUrl)`: keys map to files under `rootDir` (reject `..`, absolute paths, anything outside `^m/[0-9a-f-]{36}/[0-9a-f-]{36}(/thumb\.webp)?$`). Signed URL = `${base}/v1/dev-storage/<key>?m=PUT|GET&e=<unix>&l=<len>&t=<type>&s=<hmac>`; HMAC-SHA256 over method, key, expiry, length, content type. Export `verifyLocalSignature(...)` for the API route (constant-time compare).
- `R2Storage(env)`: S3 client with `region: 'auto'`, endpoint `R2_ACCOUNT_ENDPOINT`; `presignPut` signs `ContentType` + `ContentLength`; `presignGet` sets `ResponseContentType` when given.
- `loadEnv`: add the new keys (see Dependencies); superRefine: `STORAGE_DRIVER=local` in production → error; `local` requires `STORAGE_LOCAL_SIGNING_SECRET` ≥ 32 chars (dev/test); `r2` requires all `R2_*`. `getIntegrationStatus` reports `storage: local|r2|unconfigured`.
- Docs: `.env.example`, `CONFIGURATION.md` (server-only rows), `.gitignore` (`.data/`), README (ffmpeg install; R2 bucket CORS rule for PUT/GET from the Mini App origin).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/media/storage/object-storage.ts` | Port + factory |
| CREATE | `packages/backend-core/src/media/storage/local-disk-storage.ts` | Dev/test driver + signature helpers |
| CREATE | `packages/backend-core/src/media/storage/r2-storage.ts` | R2 adapter |
| CREATE | `packages/backend-core/src/media/storage/local-disk-storage.spec.ts` | Unit tests |
| MODIFY | `packages/backend-core/src/config/env.ts`, `integrations.ts`, `env.spec.ts` | New env keys and rules |
| MODIFY | `packages/backend-core/src/index.ts`, `package.json` | Exports, AWS SDK deps |
| MODIFY | `.env.example`, `CONFIGURATION.md`, `README.md`, `.gitignore` | Docs |

**Testing:**
- Signature: tampered key / method / expiry / length / type → invalid; expired → invalid; valid → ok.
- Path safety: `../`, absolute, unexpected key shapes rejected.
- Env: local driver in production → `EnvError`; missing signing secret → error; r2 without credentials → error; error messages never contain values.
- `R2Storage` presign unit test with fixed credentials (URL contains signed `content-length` / `content-type` headers); no network.

---

### TASK-188: Media contracts and error codes

`packages/contracts/src/media.ts`:

```ts
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
export const MediaKindSchema = z.enum(['PHOTO', 'VIDEO']);
export const MediaStateSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export const MediaFailureSchema = z.enum(['TYPE_NOT_ALLOWED', 'TOO_LARGE', 'TOO_LONG', 'UNREADABLE', 'UPLOAD_MISSING']);

export const MediaUploadInitBodySchema = z.strictObject({
  client_upload_id: z.uuid(),
  kind: MediaKindSchema,
  content_type: z.enum([...PHOTO_TYPES, ...VIDEO_TYPES]),
  size_bytes: z.int().positive(),
}); // refine: content_type matches kind

export const MediaAssetViewSchema = z.strictObject({
  id: z.uuid(), kind: MediaKindSchema, state: MediaStateSchema,
  failure: MediaFailureSchema.nullable(),
  duration_seconds: z.int().nullable(),
  thumbnail_url: z.url().nullable(),   // READY only
  created_at: z.iso.datetime(),
});
export const MediaUploadInitResponseSchema = z.strictObject({
  asset: MediaAssetViewSchema,
  upload: z.strictObject({ url: z.url(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expires_at: z.iso.datetime() }).nullable(),
});
export const MediaAssetResponseSchema = z.strictObject({ asset: MediaAssetViewSchema });

export const CreatorGalleryQuerySchema = z.strictObject({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(60).default(30) });
export const CreatorGalleryItemSchema = z.strictObject({ asset: MediaAssetViewSchema, added_at: z.iso.datetime() });
export const CreatorGalleryResponseSchema = z.strictObject({ items: z.array(CreatorGalleryItemSchema), total: z.int(), next_cursor: z.string().nullable() });

export const mediaLimitsSchema // { photo_max_bytes, video_max_bytes, video_max_seconds } returned by GET /v1/creator/media/limits
```

Paths: `CREATOR_MEDIA_UPLOADS_PATH = '/v1/creator/media/uploads'`, `creatorMediaCompletePath(id)`, `creatorMediaPath(id)`, `CREATOR_MEDIA_LIMITS_PATH`, `CREATOR_GALLERY_PATH = '/v1/creator/gallery'`.

Error codes (`errors.ts`): `MEDIA_NOT_FOUND` (404), `MEDIA_TYPE_NOT_ALLOWED` (400), `MEDIA_TOO_LARGE` (400), `MEDIA_UPLOAD_INCOMPLETE` (409: object missing, client should PUT again), `MEDIA_RATE_LIMITED` (429), `CREATOR_NOT_ACTIVE` (reuse if it exists).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/media.ts` | Schemas, types, paths |
| CREATE | `packages/contracts/src/media.spec.ts` | Schema tests |
| MODIFY | `packages/contracts/src/errors.ts`, `index.ts` | Error codes, exports |

**Testing:** kind/content_type mismatch rejected; unknown keys rejected; size 0 / negative rejected; limit bounds; view rejects extra keys.

---

### TASK-189: Migration `media_assets`, `gallery_items`, creator gallery counter

Migration `20261130010000_media` (+ `schema.prisma`):

- `enum MediaKind { PHOTO VIDEO }`, `enum MediaState { PENDING PROCESSING READY FAILED }`, `enum MediaPurpose { GALLERY }`.
- `media_assets`: `id uuid pk`, `creator_id uuid fk creators RESTRICT`, `client_upload_id uuid`, `purpose`, `kind`, `state default PENDING`, `object_key text UNIQUE`, `declared_type text`, `declared_bytes bigint`, `mime text null`, `size_bytes bigint null`, `width int null`, `height int null`, `duration_ms int null`, `thumb_key text UNIQUE null`, `failure_code text null`, `created_at`, `uploaded_at null` (complete accepted), `ready_at null`, `updated_at`. UNIQUE `(creator_id, client_upload_id)`. Index `(state, created_at)` for cleanup. CHECKs listed in "Authorization & Data Rules".
- `gallery_items`: `id uuid pk`, `creator_id fk RESTRICT`, `asset_id fk media_assets RESTRICT`, `seq int`, `added_at timestamptz default now()`. UNIQUE `(creator_id, asset_id)`, UNIQUE `(creator_id, seq)` (also serves the newest-first keyset; no extra index).
- `creators.last_gallery_seq int NOT NULL DEFAULT 0`.
- A trigger or CHECK is not needed for "gallery asset must be READY": the worker is the only writer and checks it in the transaction.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/20261130010000_media/migration.sql` | Tables, enums, CHECKs, indexes |
| MODIFY | `packages/db/prisma/schema.prisma` | Models `MediaAsset`, `GalleryItem`, `Creator.lastGallerySeq` |
| CREATE | `packages/db/src/media.int.spec.ts` | Constraint tests |

**Testing (integration):** duplicate `(creator, client_upload_id)` rejected; READY without `thumb_key` rejected; VIDEO READY without duration rejected; duplicate gallery item / seq rejected; deleting a referenced asset is refused (RESTRICT).

---

### TASK-190: `MediaUploadService`, `MediaAccessService`, sniffing (backend-core)

`packages/backend-core/src/media/`:

```ts
export function sniffMediaType(head: Buffer): { kind: 'PHOTO' | 'VIDEO'; mime: string } | null;
// JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP "RIFF"....“WEBP”; ISO-BMFF "ftyp" at offset 4:
// brand "qt  " → video/quicktime, any other ftyp brand (isom, iso2, mp41, mp42, avc1, M4V , hvc1…) → video/mp4

export class MediaUploadService {
  constructor(prisma, storage: ObjectStorage, outbox: OutboxService, limiter: FixedWindowLimiter, limits: MediaLimits);
  limits(): MediaLimits;
  init(userId: string, body: MediaUploadInitBody): Promise<{ asset: MediaAssetRow; upload: PresignedPut | null; created: boolean }>;
  complete(userId: string, assetId: string): Promise<MediaAssetRow>;
  get(userId: string, assetId: string): Promise<MediaAssetRow>;
  listGallery(userId: string, query: CreatorGalleryQuery): Promise<{ items; total; nextCursor }>;
  // used by the worker:
  markProcessed(assetId: string, meta: { mime; sizeBytes; width; height; durationMs; thumbKey }): Promise<'READY' | 'SKIPPED'>;
  markFailed(assetId: string, code: MediaFailure): Promise<void>; // deletes the object(s) after commit
  cleanup(now: Date, batch = 100): Promise<number>;               // PENDING > 24 h, FAILED > 24 h: delete objects, then rows
}

export class MediaAccessService {
  constructor(prisma, storage: ObjectStorage);
  thumbnailUrlForOwner(userId: string, asset: { thumbKey: string }): Promise<string>; // 15 min
}
```

- `init`: creator ACTIVE check; rate limit; kind/type/size vs limits (`MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_TOO_LARGE`); `INSERT … ON CONFLICT (creator_id, client_upload_id) DO NOTHING RETURNING`, else load existing (scoped). Presign only for PENDING.
- `complete`: in a tx `SELECT … FOR UPDATE` scoped by creator; not PENDING → return as is. `head(key)`: null → 409 `MEDIA_UPLOAD_INCOMPLETE` (state unchanged). Size ≠ declared → FAILED `TOO_LARGE`/`UNREADABLE`. `readRange(0, 63)` → `sniffMediaType`; null or kind ≠ declared → FAILED `TYPE_NOT_ALLOWED`. Otherwise PROCESSING, `uploaded_at = now()`, store sniffed `mime`, outbox `media.uploaded {asset_id}` dedupe `media:<id>:uploaded`. Object deletion for FAILED happens after commit.
- `listGallery`: join `gallery_items` + READY assets of my creator, keyset on `gallery_items.seq` desc (seq is the gallery order everywhere: list, viewer position, admin "Media #N"), opaque base64url cursor; `total` = count of my gallery items; map thumbnails through `MediaAccessService`.
- Add `MEDIA_UPLOADED: 'media.uploaded'` to `OutboxEventType`.
- Row → view mapping in one function (`toMediaAssetView`), never spreads the row (no keys leak).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/media/sniff.ts` + `sniff.spec.ts` | Magic bytes |
| CREATE | `packages/backend-core/src/media/media-upload.service.ts` | Upload lifecycle, gallery list, worker commits, cleanup |
| CREATE | `packages/backend-core/src/media/media-access.service.ts` | Signed URL issuance after checks |
| CREATE | `packages/backend-core/src/media/media-upload.service.int.spec.ts` | Integration tests |
| CREATE | `packages/backend-core/src/media/index.ts` | Exports |
| MODIFY | `packages/backend-core/src/outbox/outbox.service.ts` | `media.uploaded` type |
| MODIFY | `packages/backend-core/src/index.ts` | Exports |

**Testing:**
- Sniff: each accepted type (fixture bytes), MOV vs MP4 brand, a renamed text file → null, truncated buffer → null.
- `init`: replay same `client_upload_id` → same asset, new URL; another creator's init with the same id → separate asset; over-limit / wrong type → errors, nothing stored; rate limit 31st call → 429; blocked creator → 403.
- `complete`: missing object → 409, state still PENDING; wrong magic → FAILED + object gone; size mismatch → FAILED; ok → PROCESSING + exactly one outbox row; concurrent double complete → one outbox row; another creator's asset id → 404.
- `markProcessed` twice → one gallery item, seq increments once; two assets processed concurrently for one creator → seq 1 and 2, no gap or clash.
- `cleanup`: removes old PENDING and FAILED rows + objects, never touches READY or recent PENDING.
- `listGallery`: only READY gallery items of my creator, newest first, cursor stable across a new insert; the response contains no object key.

---

### TASK-191: API — creator media/gallery endpoints and dev-storage routes

`apps/api/src/modules/media/` (`MediaModule`, imported by `AppModule`):

| Method | Path | Guard | Response |
|---|---|---|---|
| GET | `/v1/creator/media/limits` | `@Roles('CREATOR')` | `MediaLimits` |
| POST | `/v1/creator/media/uploads` | `@Roles('CREATOR')` | 201 new / 200 replay, `MediaUploadInitResponse` |
| POST | `/v1/creator/media/uploads/:assetId/complete` | `@Roles('CREATOR')` | 200 `MediaAssetResponse`; 409 `MEDIA_UPLOAD_INCOMPLETE` |
| GET | `/v1/creator/media/:assetId` | `@Roles('CREATOR')` | 200 `MediaAssetResponse` |
| GET | `/v1/creator/gallery` | `@Roles('CREATOR')` | 200 `CreatorGalleryResponse` |

All `Cache-Control: no-store`. `:assetId` validated as uuid (malformed → same 404). Providers built from `createObjectStorage(env)` (one instance, `STORAGE` token) so later modules reuse it.

`DevStorageController` (`apps/api/src/modules/media/dev-storage.controller.ts`), registered **only** when `STORAGE_DRIVER=local` and `NODE_ENV !== 'production'`:
- `PUT /v1/dev-storage/*`: verify signature (`m=PUT`, expiry, length, type) before reading the body; `Content-Length` must equal the signed length and `Content-Type` the signed type; stream the raw body to a temp file then rename (Fastify content-type parser for this route only that passes the stream through, route-level `bodyLimit` = 210 MB). 403 on bad signature, 413/400 on mismatch.
- `GET /v1/dev-storage/*`: verify signature (`m=GET`), stream the file with the signed content type, support a single `Range: bytes=a-b` (206 + `Content-Range`, `Accept-Ranges: bytes`), 404 when missing.
- No user auth on these routes (the signature is the authority, like R2). CORS: the API's existing allowlist applies.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/media/media.module.ts`, `tokens.ts` | Providers (storage, services, limiter) |
| CREATE | `apps/api/src/modules/media/creator-media.controller.ts` | Upload + gallery endpoints |
| CREATE | `apps/api/src/modules/media/dev-storage.controller.ts` | Local driver routes |
| MODIFY | `apps/api/src/app.module.ts` | Import `MediaModule` |
| CREATE | `apps/api/test/creator-media.int.spec.ts` | Integration tests |
| CREATE | `apps/api/test/dev-storage.int.spec.ts` | Signature, streaming, Range |

**Testing:**
- Full flow through `app.inject`: init → PUT to the signed URL → complete → PROCESSING; gallery empty until the worker step (call `markProcessed` directly in the test).
- USER token → 403 on every route; no token → 401; blocked creator → 401; another creator's asset id → 404; malformed id → 404.
- `roles-declared.spec.ts` still passes.
- Dev storage: wrong signature / expired / wrong length / wrong type → rejected and no file written; Range request → 206 with the right bytes; route not registered when `STORAGE_DRIVER=r2` or production.
- Responses never contain `object_key`, `m/` paths or the bucket host when driver = r2 (snapshot the JSON keys).

---

### TASK-192: Worker — media processing queue and cleanup loop

`apps/worker/src/media/`:
- `media.ts` → `startMedia({ env, prisma, logger })`: checks ffprobe; creates the BullMQ queue `media` and an `OutboxDispatcher` with `handledTypes: ['media.uploaded']` (same pattern as `notifications.ts`), a BullMQ `Worker` (concurrency 2) running `MediaProcessor`, and a cleanup loop every 10 min calling `MediaUploadService.cleanup`.
- `media-processor.ts`:
  1. Load the asset (state must be PROCESSING, else complete the job).
  2. `storage.download(key, tmp)` into a per-job temp dir (removed in `finally`).
  3. Photo: `sharp(tmp).metadata()` (fails → `UNREADABLE`); format must match the sniffed mime; re-encode with `.rotate()` and no metadata (JPEG `quality: 90, mozjpeg: false`, PNG default, WebP `quality: 90`) → cleaned file; thumbnail `resize(480, 480, { fit: 'cover' }).webp({ quality: 80 })`.
  4. Video: `ffprobe -v error -print_format json -show_format -show_streams`; container must be mp4/mov family, first video stream codec `h264` or `hevc`, duration ≤ `MEDIA_MAX_VIDEO_SECONDS` (else `TOO_LONG`), otherwise `UNREADABLE`/`TYPE_NOT_ALLOWED`. Remux `ffmpeg -i in -map 0 -map_metadata -1 -c copy -movflags +faststart out.<ext>`; poster `ffmpeg -ss min(1, duration/2) -i out -frames:v 1 poster.jpg` → sharp 480 webp.
  5. Upload cleaned original over the same key (same content type), upload the thumbnail to `thumb_key`.
  6. `markProcessed(...)` (READY + gallery item). Any expected failure → `markFailed(code)`. Unexpected error → job retry (BullMQ attempts 3, backoff) then `markFailed('UNREADABLE')`.
- Child processes via `execFile` with argument arrays (never a shell string), a 120 s timeout each. Logs: asset id + outcome code only.
- Wire into `apps/worker/src/main.ts` next to notifications and realtime; stop cleanly.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/worker/src/media/media.ts` | Queue, dispatcher, worker, cleanup loop |
| CREATE | `apps/worker/src/media/media-processor.ts` | Verify, clean, thumbnail, commit |
| CREATE | `apps/worker/src/media/ffmpeg.ts` | `probe()`, `remux()`, `poster()` wrappers |
| CREATE | `apps/worker/src/media/media-processor.int.spec.ts` | Integration tests with tiny generated fixtures |
| MODIFY | `apps/worker/src/main.ts`, `package.json` | Start/stop, `sharp` dep |
| MODIFY | `pnpm-workspace.yaml` | Approve sharp build script if needed |

**Testing (integration, local storage in a temp dir; fixtures generated in the test with sharp and `ffmpeg -f lavfi -i testsrc`):**
- JPEG with GPS EXIF → READY, stored file has no EXIF/GPS (`sharp().metadata().exif` undefined), thumbnail exists, gallery item seq 1.
- MP4 H.264 2 s with a `location` metadata tag → READY, duration ≈ 2000 ms, remuxed file has no location tag (ffprobe), poster exists.
- Video longer than the limit (set the limit to 1 s in the test) → FAILED `TOO_LONG`, objects deleted, no gallery item.
- Corrupt JPEG (valid magic, garbage body) → FAILED `UNREADABLE`.
- Same job twice → one gallery item.
- ffprobe missing (`FFPROBE_PATH=/nonexistent`) → processor not registered, event stays PENDING, one warning log.

---

### TASK-193: `GalleryTile` shared component

`packages/ui/src/components/gallery-tile/` (used by the Mini App now and by admin thumbnails in US-035): states from `CrMain` "Tile galeri creator" and `CrGallery`/`CrGalleryUploading`/`CrGalleryDone`/`CrStatesGallery`:

```ts
type GalleryTileProps =
  | { state: 'ready'; kind: 'PHOTO' | 'VIDEO'; thumbnailUrl: string | null; durationSeconds?: number | null; isNew?: boolean; selected?: boolean; onOpen?: () => void; label: string }
  | { state: 'uploading'; progress: number /* 0–100 */ }
  | { state: 'failed'; onRetry: () => void };
```

- Exact values from the boards (square tile, radius, gap, video duration badge "0:48", "Baru" chip, "64%" overlay, "Gagal" + "Coba Lagi"). `thumbnailUrl` null → neutral placeholder (never the original). `onError` on the image calls an optional `onThumbnailError` so the page can refetch.
- `formatDuration(seconds)` helper (`m:ss`).
- Add to both `/__preview` pages with `data-preview-section="gallery-tile"`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/ui/src/components/gallery-tile/GalleryTile.tsx`, `.module.css`, `GalleryTile.spec.tsx` | Component |
| CREATE | `packages/ui/src/format/duration.ts` (+ spec) | `m:ss` |
| MODIFY | `packages/ui/src/index.ts` | Export |
| MODIFY | `apps/miniapp/src/preview/Preview.tsx` | Preview section |

**Testing:** each state renders the board text ("Baru", "64%", "Gagal", "Coba Lagi"); retry calls `onRetry`; no image element when `thumbnailUrl` is null; duration formatting (0 → "0:00", 72 → "1:12", 3600 → "60:00").

---

### TASK-194: Mini App `/gallery` with upload

`apps/miniapp/src/gallery/`:
- API client methods (in the existing `createMiniappApi`): `mediaLimits()`, `initUpload(body)`, `completeUpload(id)`, `getMedia(id)`, `gallery(cursor?)`.
- `upload-file.ts`: `putWithProgress(upload, file, onProgress, signal)` via `XMLHttpRequest` (fetch has no upload progress), sends exactly `upload.headers`, no credentials.
- `useGallery()`: first page + next pages on scroll near the bottom; `refresh()`; loading / error / empty.
- `useUploads()`: in-memory list of uploading tiles `{ localId, clientUploadId, file, phase: 'uploading'|'processing'|'failed', progress, failureKind: 'network'|'rejected' }`. Flow: client-side pre-check (type + size against `mediaLimits`; rejected → placeholder toast, no request) → `initUpload` → PUT → `completeUpload` (409 → PUT again once with a fresh `initUpload`) → poll `getMedia` every 2 s while PROCESSING → READY: remove the uploading tile, prepend the item with `isNew`, increment the count, toast "Media berhasil diunggah ke galeri". Network error → tile `failed` with the `CrStatesGallery` banner "Unggahan gagal · Koneksi terputus saat mengunggah. Media belum masuk ke galeri."; Coba Lagi resumes with the **same** `clientUploadId`. Server FAILED → tile `failed`; Coba Lagi starts over with a new `clientUploadId` (placeholder toast for the reason, see gaps).
- `GalleryPage.tsx` at `/gallery` (replaces the shell placeholder): header "Galeri" + Upload button (hidden `<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime">`), "{total} foto dan video", note "Galeri hanya terlihat oleh subscriber aktif.", grid (uploading tiles first, then items). States: loading, empty ("Galeri masih kosong" / "Upload foto atau video. Media galeri hanya terlihat oleh subscriber aktif." / Upload), load failed (reuse the app's error panel with retry — gap if `CrStatesGallery` has none). Tiles are not clickable until US-033.
- Copy constants in `gallery-copy.ts`; placeholders marked `// design gap`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/src/gallery/GalleryPage.tsx`, `gallery.module.css`, `gallery-copy.ts` | Screen |
| CREATE | `apps/miniapp/src/gallery/useGallery.ts`, `useUploads.ts`, `upload-file.ts` | Data + upload flow |
| CREATE | `apps/miniapp/src/gallery/GalleryPage.spec.tsx`, `useUploads.spec.tsx` | Tests |
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec) | Media/gallery calls |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | `/gallery` → `GalleryPage` |
| MODIFY | `apps/miniapp/test/` fake API (if present) | Fixtures for visual check |

**Testing:**
- Happy path with a fake API + fake XHR: progress shown, processing, READY → "Baru" tile, count +1, toast.
- Network failure mid-PUT → failure banner; Coba Lagi reuses the same `client_upload_id`.
- 409 on complete → one re-PUT, then success.
- Server FAILED → failed tile; Coba Lagi uses a new id.
- Over-limit file → no request, placeholder toast.
- Empty and error states render the board copy.

---

### TASK-195: Visual check, docs and decisions log

- `pnpm visual` entries at 390 px: `CrGallery` (fixture of 12 items), `CrGalleryUploading` (one uploading tile at 64 %, without the DEMO strip), `CrGalleryDone` (13 items, first "Baru", toast), `CrStatesGallery` frames (empty, loading, failed upload). Review every sheet.
- `tech-stack.md`: decisions rows (storage drivers, formats, limits, location removal, media number, polling shortcut, signed URL lifetimes) and pinned versions (`@aws-sdk/*`, `sharp`); replace the "Upload size/format/duration limits — TBD" row.
- `codebase-map.md`: US-032 entry, entities `MediaAsset` / `GalleryItem`, endpoints, the `media` queue, `/gallery` route, `GalleryTile`.
- `design-integration.md` Known Gaps: refused-file message (type / size / length) placeholder, gallery load-failed copy, no seed media.
- `CLAUDE.md` "Current State": one line for US-032.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `visual/` specs | Board screenshots |
| MODIFY | `.agile/guidelines/tech-stack.md`, `codebase-map.md`, `design-integration.md` | Docs |
| MODIFY | `CLAUDE.md` | Current state |

**Testing:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; `pnpm visual` sheets reviewed.
