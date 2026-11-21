# Configuration Guide

How configuration and secrets are handled in CreatorChat (brief §15, §18). Scope today: **local development only** — no deployment until instructed.

## Principles

- Only `.env.example` files are committed. Real `.env` files are git-ignored.
- Placeholders only — never commit real bot tokens, R2 keys, AI keys, or admin passwords.
- **Server vs client:** variables prefixed `VITE_` are bundled into the browser and are public. Never put a secret in a `VITE_*` variable.
- Secrets entered later via the admin dashboard (Telegram token, R2 secret, AI key) are stored **encrypted with `MASTER_ENCRYPTION_KEY`** in the database, never returned in plaintext by any read API. Env values act as bootstrap/defaults.
- Missing external secrets must not block schema/UI/adapter work: apps start with fakes (fake AI provider, fake Telegram sender, fake/local storage) and report which integrations are unconfigured.
- Diagnostics never print secret values — only "set / not set".

## Files

```
.env.example                  # root: shared server variables (api + worker)
apps/miniapp/.env.example     # VITE_* public values only
apps/admin/.env.example       # VITE_* public values only
```

## Variables

### Server (api + worker) — root `.env`

| Variable                                                                      | Purpose                                                                                                                                                                                                  | Example placeholder                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`                                                                    | `development` / `test` / `production`                                                                                                                                                                    | `development`                                                          |
| `LOG_LEVEL`                                                                   | Log verbosity                                                                                                                                                                                            | `info`                                                                 |
| `DATABASE_URL`                                                                | PostgreSQL connection                                                                                                                                                                                    | `postgresql://creatorchat:creatorchat@localhost:5432/creatorchat`      |
| `DATABASE_URL_TEST`                                                           | Separate DB for integration tests                                                                                                                                                                        | `postgresql://creatorchat:creatorchat@localhost:5432/creatorchat_test` |
| `REDIS_URL`                                                                   | Redis for BullMQ + presence                                                                                                                                                                              | `redis://localhost:6379`                                               |
| `API_PORT`                                                                    | API listen port                                                                                                                                                                                          | `3000`                                                                 |
| `API_PUBLIC_URL`                                                              | Public API base (webhook target)                                                                                                                                                                         | `https://<tunnel-or-domain>`                                           |
| `ALLOWED_ORIGINS`                                                             | Comma-separated allowlist for CORS **and** for the Origin check on unsafe admin requests (miniapp, admin)                                                                                                | `http://localhost:5173,http://localhost:5174`                          |
| `TELEGRAM_BOT_TOKEN`                                                          | Bot token (secret); also read by the worker to send the creator-request result                                                                                                                           | `<set-locally>`                                                        |
| `TELEGRAM_BOT_USERNAME`                                                       | Bot username (for deep links)                                                                                                                                                                            | `<bot_username>`                                                       |
| `TELEGRAM_WEBHOOK_SECRET`                                                     | Webhook secret header value (secret). At least 32 characters and different from the bot token, otherwise the webhook answers 503 and is reported unconfigured. Registered by `pnpm telegram:webhook set` | `<random 32+ chars>`                                                   |
| `TELEGRAM_INITDATA_MAX_AGE_SECONDS`                                           | initData freshness window                                                                                                                                                                                | `86400` (confirm)                                                      |
| `MINIAPP_URL`                                                                 | Mini App URL registered with the bot; the bot's button opens `<origin>/creators/<code>`. Must be https and serve the SPA fallback for unknown paths                                                      | `https://<tunnel-or-domain>`                                           |
| `USER_SESSION_SECRET`                                                         | Signs Mini App session tokens (secret)                                                                                                                                                                   | `<random 32+ bytes>`                                                   |
| `ADMIN_ACCESS_TOKEN_SECRET`                                                   | Signs the admin access JWT (HS256, 15 min). Required for admin login: unset or under 32 characters makes `/v1/admin/auth/*` answer 503 (secret)                                                          | `<random 32+ bytes>`                                                   |
| `ADMIN_REFRESH_TOKEN_SECRET`                                                  | Keys the HMAC of admin refresh tokens stored in `sessions` (secret). Must differ from the access secret                                                                                                  | `<random 32+ bytes>`                                                   |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` / `COOKIE_DOMAIN`                         | Admin cookie policy per topology. `COOKIE_SECURE=false` only for http://localhost; an empty `COOKIE_DOMAIN` means host-only                                                                              | `true` / `lax` / _(empty)_                                             |
| `MASTER_ENCRYPTION_KEY`                                                       | Encrypts secrets stored from the dashboard (secret)                                                                                                                                                      | `<random 32 bytes, base64>`                                            |
| `R2_ACCOUNT_ENDPOINT`                                                         | R2 S3 endpoint                                                                                                                                                                                           | `https://<account>.r2.cloudflarestorage.com`                           |
| `R2_BUCKET`                                                                   | Private bucket name                                                                                                                                                                                      | `<bucket>`                                                             |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`                                   | R2 credentials (secret)                                                                                                                                                                                  | `<set-locally>`                                                        |
| `STORAGE_DRIVER`                                                              | `local` (default; dev and tests, refused in production) or `r2`. `r2` needs every `R2_*` value                                                                                                           | `local`                                                                |
| `STORAGE_LOCAL_DIR` / `STORAGE_LOCAL_SIGNING_SECRET`                          | Folder for local media files (git-ignored) and the key that signs its URLs, at least 32 characters (secret). Without the key, media answers 503                                                          | `.data/media` / `<set-locally>`                                        |
| `MEDIA_MAX_PHOTO_BYTES` / `MEDIA_MAX_VIDEO_BYTES` / `MEDIA_MAX_VIDEO_SECONDS` | Upload limits until the Phase G admin screen owns them                                                                                                                                                   | `10485760` / `209715200` / `300`                                       |
| `ACCESS_REMINDER_LEAD_DAYS` | Days before access ends when the bot reminds the customer (1–30, server only); the brief leaves the default open, `3` | `3` |
| `FFMPEG_PATH` / `FFPROBE_PATH`                                                | Binaries the worker uses for video checks and posters                                                                                                                                                    | `ffmpeg` / `ffprobe`                                                   |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY`                                     | Only once a provider is chosen; `fake` until then                                                                                                                                                        | `fake`                                                                 |

Use distinct secrets per purpose and per environment. Generate locally (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

### Client — `apps/miniapp/.env`, `apps/admin/.env`

| Variable                     | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `VITE_API_BASE_URL`          | API base URL                              |
| `VITE_TELEGRAM_BOT_USERNAME` | For the "Buka di Telegram" link (miniapp) |

Nothing else. No tokens, no keys.

The admin app does not use `VITE_API_BASE_URL` for login: it calls `/v1/admin/...` on its own origin, and in development Vite proxies `/v1` to the API (target taken from the root `API_PORT`). A deployed topology must serve the dashboard and the API from the same site, or set `COOKIE_SAMESITE` / `COOKIE_DOMAIN` accordingly; that is decided at deployment time.

## Local Development

PostgreSQL and Redis are installed natively on the dev machine (no Docker); Node apps run with pnpm. Full steps, including creating the database with `scripts/setup-postgres.sql`, are in `README.md`.

```bash
pnpm install
cp .env.example .env        # then fill local values (DB password from scripts/setup-postgres.sql)
pnpm db:migrate
pnpm db:seed                # admin seed asks for / generates a password, shown once
pnpm dev
```

### Real Telegram testing

The Mini App and webhooks need a public HTTPS URL (tunnel or domain). Choosing and running a tunnel is the user's decision — agents don't publish one automatically. Without it, develop against deterministic local fixtures; there is **no auth bypass** in production builds.

For the Mini App login there is a local alternative that keeps the real validation: `pnpm telegram:initdata` prints `initData` signed with `TELEGRAM_BOT_TOKEN`, and the Mini App dev server accepts it through `?tgdev=<initData>` (development builds only). Locally the token can be any value as long as the API and the command read the same `.env`; it must be the real bot token only when Telegram itself sends the data. `USER_SESSION_SECRET` must be at least 32 characters and differ from the two admin secrets; without it (or without the token) `POST /v1/auth/telegram` and `/v1/me` answer 503 while the rest of the API runs. `ALLOWED_ORIGINS` must contain the Mini App origin because the Mini App calls the API cross-origin with an `Authorization` header.

## Settings Stored in the Database

Admin "Pengaturan" (brief §11) manages: general (name/logo/timezone), Telegram (bot username, token masked, status/test), Media (R2 bucket/connection, secret masked, upload limits, test), notification templates/access reminders, AI provider/model/limits. Rules:

- Secret fields: write-only; read returns masked/"set" only; empty on update = keep existing.
- Every change writes `AuditLog` with sanitized before/after.
- Test-connection calls use only allowed endpoint shapes (no arbitrary URLs).

## Production (later)

Out of scope until instructed: VPS setup, TLS, explicit allowed origins, PostgreSQL/Redis not publicly exposed, off-host PostgreSQL backups with a tested restore, separate R2 retention policy.
