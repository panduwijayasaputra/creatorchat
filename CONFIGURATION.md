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
infra/docker-compose.yml      # local postgres + redis (credentials are local-only)
```

## Variables

### Server (api + worker) — root `.env`

| Variable | Purpose | Example placeholder |
|----------|---------|---------------------|
| `NODE_ENV` | `development` / `test` / `production` | `development` |
| `LOG_LEVEL` | Log verbosity | `info` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://creatorchat:creatorchat@localhost:5432/creatorchat` |
| `DATABASE_URL_TEST` | Separate DB for integration tests | `postgresql://creatorchat:creatorchat@localhost:5432/creatorchat_test` |
| `REDIS_URL` | Redis for BullMQ + presence | `redis://localhost:6379` |
| `API_PORT` | API listen port | `3000` |
| `API_PUBLIC_URL` | Public API base (webhook target) | `https://<tunnel-or-domain>` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (miniapp, admin) | `http://localhost:5173,http://localhost:5174` |
| `TELEGRAM_BOT_TOKEN` | Bot token (secret) | `<set-locally>` |
| `TELEGRAM_BOT_USERNAME` | Bot username (for deep links) | `<bot_username>` |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook secret header value (secret) | `<random>` |
| `TELEGRAM_INITDATA_MAX_AGE_SECONDS` | initData freshness window | `86400` (confirm) |
| `MINIAPP_URL` | Mini App URL registered with the bot | `https://<tunnel-or-domain>` |
| `USER_SESSION_SECRET` | Signs Mini App session tokens (secret) | `<random 32+ bytes>` |
| `ADMIN_ACCESS_TOKEN_SECRET` | Signs admin access JWT (secret) | `<random 32+ bytes>` |
| `ADMIN_REFRESH_TOKEN_SECRET` | Admin refresh token signing/pepper (secret) | `<random 32+ bytes>` |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` / `COOKIE_DOMAIN` | Admin cookie policy per topology | `true` / `lax` / _(empty)_ |
| `MASTER_ENCRYPTION_KEY` | Encrypts secrets stored from the dashboard (secret) | `<random 32 bytes, base64>` |
| `R2_ACCOUNT_ENDPOINT` | R2 S3 endpoint | `https://<account>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Private bucket name | `<bucket>` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 credentials (secret) | `<set-locally>` |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` | Only once a provider is chosen; `fake` until then | `fake` |

Use distinct secrets per purpose and per environment. Generate locally (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

### Client — `apps/miniapp/.env`, `apps/admin/.env`

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API base URL |
| `VITE_TELEGRAM_BOT_USERNAME` | For the "Buka di Telegram" link (miniapp) |

Nothing else. No tokens, no keys.

## Local Development

PostgreSQL and Redis run in Docker; Node apps run with pnpm. (Target commands — implemented in Phase A.)

```bash
pnpm install
cp .env.example .env        # then fill local values
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm db:migrate
pnpm db:seed                # admin seed asks for / generates a password, shown once
pnpm dev
```

Stop containers without losing data:
```bash
docker compose -f infra/docker-compose.yml stop
```
Do **not** use `down -v` routinely — it deletes the database volume.

### Real Telegram testing
The Mini App and webhooks need a public HTTPS URL (tunnel or domain). Choosing and running a tunnel is the user's decision — agents don't publish one automatically. Without it, develop against deterministic local fixtures; there is **no auth bypass** in production builds.

## Settings Stored in the Database

Admin "Pengaturan" (brief §11) manages: general (name/logo/timezone), Telegram (bot username, token masked, status/test), Media (R2 bucket/connection, secret masked, upload limits, test), notification templates/access reminders, AI provider/model/limits. Rules:

- Secret fields: write-only; read returns masked/"set" only; empty on update = keep existing.
- Every change writes `AuditLog` with sanitized before/after.
- Test-connection calls use only allowed endpoint shapes (no arbitrary URLs).

## Production (later)

Out of scope until instructed: VPS + production Docker Compose, TLS, explicit allowed origins, PostgreSQL/Redis not publicly exposed, off-host PostgreSQL backups with a tested restore, separate R2 retention policy.
