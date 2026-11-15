# CreatorChat

Telegram Mini App for private chat between subscribers and creators, with a separate web admin dashboard. This repository is the pnpm workspace for the API, worker, Mini App and admin.

> Status: Phase A (foundation). Local development only — nothing here is deployed, and the apps run
> without real Telegram, Cloudflare R2 or AI credentials.

## What runs where

| Part                           | Path                    | Local address                            |
| ------------------------------ | ----------------------- | ---------------------------------------- |
| API (NestJS + Fastify)         | `apps/api`              | http://localhost:3000 (`GET /v1/health`) |
| Worker (background jobs)       | `apps/worker`           | no port                                  |
| Mini App (React + Vite)        | `apps/miniapp`          | http://localhost:5173                    |
| Admin (React + Vite)           | `apps/admin`            | http://localhost:5174                    |
| Database schema, seed          | `packages/db`           |                                          |
| Shared schemas and error codes | `packages/contracts`    |                                          |
| Shared server logic and config | `packages/backend-core` |                                          |

PostgreSQL and Redis are the only things that run outside Node.

## Prerequisites

- **Node.js 24** and **pnpm 12** (`node -v`, `pnpm -v`).
- **PostgreSQL 18** and **Redis**, installed natively installed on your machine:

### PostgreSQL

PostgreSQL 18 as a Windows service is fine. As a superuser, edit the password in
`scripts/setup-postgres.sql`, then run it once:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f scripts/setup-postgres.sql
```

It creates the role `creatorchat` and the databases `creatorchat` and `creatorchat_test`. It is safe to re-run. Put the same password into `DATABASE_URL` and `DATABASE_URL_TEST` in your `.env` (next section).

### Redis

Redis has no official Windows build. Use [Memurai](https://www.memurai.com/) (a Windows installer) or Redis inside WSL 2 (`sudo apt install redis-server && redis-server`). Anything answering on `localhost:6379` works; change `REDIS_URL` otherwise.

## First run

```bash
pnpm install
cp .env.example .env                     # then edit DATABASE_URL / DATABASE_URL_TEST if you changed the password
cp apps/miniapp/.env.example apps/miniapp/.env
cp apps/admin/.env.example apps/admin/.env
pnpm db:migrate                          # applies the committed migrations to the dev database
pnpm db:seed                             # fixture users + an admin account (see below)
pnpm dev                                 # api + worker + miniapp + admin
```

Then check: `curl http://localhost:3000/v1/health` should return
`{"status":"ok","checks":{"db":"up","redis":"up"}}`, and the Mini App and admin pages should show
"API: ok". If PostgreSQL or Redis is down, health returns HTTP 503 with `"status":"degraded"` and says
which one.

### Admin password from the seed

`pnpm db:seed` creates an admin account named `admin` (change with `SEED_ADMIN_USERNAME`).

- If `SEED_ADMIN_PASSWORD` is set in `.env`, that password is used.
- If it is empty, a random password is generated and **printed once** in the terminal. Copy it right away; it is stored only as an Argon2id hash and cannot be recovered.
- Running the seed again never changes an existing admin's password and never duplicates data.

Sign in at http://localhost:5174/login with that username and password (see "Admin login" below).

## Admin login

The admin dashboard needs a signed-in admin: opening any page while signed out sends you to `/login`.

```bash
pnpm admin:create --username nadia.admin                    # generates a password and prints it once
pnpm admin:create --username nadia.admin --reset-password   # new password, signs that admin out everywhere
```

- To choose the password yourself, put it in an environment variable and pass the variable's **name**:
  `ADMIN_PW=... pnpm admin:create --username nadia.admin --password-env ADMIN_PW` (at least 12 characters).
  A password is never accepted as a command-line argument, so it stays out of shell history.
- The password is stored only as an Argon2id hash. A generated password is shown once and cannot be recovered; use `--reset-password` if it is lost.
- The command refuses to run with `NODE_ENV=production`, and refuses a `*_test` database.
- Before the first login, `.env` needs real values for `ADMIN_ACCESS_TOKEN_SECRET` and `ADMIN_REFRESH_TOKEN_SECRET` (two different random strings, 32+ characters; see CONFIGURATION.md). Without them the API still starts but the login answers 503.
- In development the admin app calls the API through its own dev server: Vite forwards `/v1` to `http://127.0.0.1:API_PORT`, so the browser sees one origin and the cookies stay host-only. `ALLOWED_ORIGINS` must contain `http://localhost:5174`.
- Five wrong passwords lock that username for 15 minutes (counted in Redis, so restarting Redis clears a lock).
- Tokens live in HttpOnly cookies; nothing is stored in `localStorage`.

## Mini App login (Telegram)

The Mini App signs people in with their Telegram identity only. Inside Telegram the API validates the
signed `initData` with the bot token; outside Telegram the app shows "Buka di Telegram". There is no
other web login.

Try it locally without Telegram (the API still validates the signature for real):

1. In `.env` set `TELEGRAM_BOT_TOKEN` (any value works locally, e.g. `123456:local-dev-token`; use a real
   token only when testing with a real bot), `USER_SESSION_SECRET` (32+ random characters) and keep
   `ALLOWED_ORIGINS` containing `http://localhost:5173`. Without the token or secret the API still starts,
   but `POST /v1/auth/telegram` answers 503.
2. Run `pnpm dev`, then print signed initData:

   ```bash
   pnpm telegram:initdata --id 100000001 --name Nadia --username nadia
   ```

3. Open the printed `http://localhost:5173/?tgdev=...` URL. The first visit shows "Lanjutkan dengan Telegram";
   after the first login later visits connect on their own. A new Telegram id creates a USER account;
   to see the creator side, change that account's role in the database (admin approval comes later).
4. `--age-seconds 90000` makes the data older than the 24 h window to see "Sesi Telegram berakhir".

The `?tgdev=` support exists only in the development server and is not part of production builds. The
command refuses `NODE_ENV=production` and never prints the bot token. Testing inside the real Telegram
WebView needs a bot and a public HTTPS URL (see CONFIGURATION.md, "Real Telegram testing").

## Bot entry and creator deep links

The bot is a grammY webhook at `POST /v1/telegram/webhook`. `/start c_<code>` replies with a button that
opens the Mini App at `MINIAPP_URL/creators/<code>`; `/start` alone (and the menu button) opens the app
without a destination. The code only picks the page: the API resolves it after login
(`GET /v1/creators/by-code/<code>`) and grants nothing. Codes are 8 characters from `a-z2-7`; the seed
creators are `salsa234`, `kirana23` and `dinda234`.

Without `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (32+ characters) and
`MINIAPP_URL` the API still starts; the webhook answers 503 and the startup log shows
`telegramWebhook: unconfigured`.

Connect a **real** bot (your own token, and your own HTTPS tunnel or domain for `API_PUBLIC_URL` and
`MINIAPP_URL`; the Mini App host must rewrite unknown paths such as `/creators/<code>` to `index.html`):

```bash
pnpm telegram:webhook set            # dry run: prints what would change
pnpm telegram:webhook set --yes      # setWebhook + menu button
pnpm telegram:webhook info           # what Telegram has registered
pnpm telegram:webhook delete --yes
```

Without a real bot you can still try the resolver: log in with `pnpm telegram:initdata`, then open
`http://localhost:5173/creators/salsa234?tgdev=...` (an unknown code shows "Creator tidak tersedia").

## Roles and blocked accounts

Every user endpoint declares which role may call it (`@Roles(...)`); the API answers 403 `FORBIDDEN_ROLE`
otherwise, and the Mini App sends a USER away from creator routes and a CREATOR away from customer routes.
`AccountSecurityService` (backend-core) is the only code that blocks, unblocks or re-roles an account: each
change bumps `session_version` and revokes that user's sessions, so an old session stops working on its
next request. No admin screen calls it yet (Phase B/G); the integration tests do
(`pnpm --filter @creatorchat/api test`).

To see it by hand against your **local dev** database: log in with `?tgdev=`, then in `psql` run
`UPDATE users SET status = 'BLOCKED' WHERE telegram_id = <id>;` and reload. The old session is rejected
(the API re-reads the status on every request) and a new login shows the placeholder blocked message.
Set the status back to `ACTIVE` to undo it. There is no socket gateway yet; its connection check
(`authorizeConnection`) is tested as a function.

### Fixture data

The seed adds six fictional accounts from the design samples (creators Salsa, Kirana, Dinda; users Maya Lestari, Raka Putra, Luna Aurora) with fake Telegram IDs in the reserved range `9000000001`–`9000000999`. The seed refuses to run when `NODE_ENV=production`.

## Everyday commands

| Command                                       | What it does                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                                    | Builds the shared packages once, then starts api, worker, miniapp and admin |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Static checks and production builds                                         |
| `pnpm test`                                   | Unit and integration tests (see below)                                      |
| `pnpm db:migrate`                             | `prisma migrate dev` against the **dev** database                           |
| `pnpm db:seed`                                | Idempotent fixtures + admin                                                 |
| `pnpm admin:create`                           | Create an admin, or `--reset-password` (see Admin login)                    |
| `pnpm telegram:initdata`                      | Print signed fake initData to try the Mini App login locally                |
| `pnpm db:generate`                            | Regenerate the Prisma client after a schema change                          |
| `pnpm format`                                 | Prettier                                                                    |
| `pnpm visual`                                 | Visual QA: screenshots of the apps next to the design PNGs (see below)      |

## Component preview and visual QA

With `pnpm dev` running, the shared components can be reviewed on development-only pages (not part of
production builds):

- Mini App: http://localhost:5173/__preview (also the shells at `/chats` and `/inbox`)
- Admin: http://localhost:5174/__preview (the shell at `/`)

`pnpm visual` starts its own Vite servers on ports 5273/5274, screenshots regions of the apps and lays
each next to the same region of the design handoff PNG. Output goes to `visual/output/` (git-ignored):
`sheets/*.png` are the side-by-side images to look at, `report.txt` lists sizes and an informational
diff percentage. It is not part of `pnpm test`. One-time setup: `pnpm exec playwright install chromium`.

## Tests

`pnpm test` runs everything. Integration tests use a **separate** database from `DATABASE_URL_TEST`
(default `creatorchat_test`). They refuse to run unless that database is local, its name ends in
`_test`, and it differs from `DATABASE_URL`, so your dev data is never touched. The test database is
created and migrated automatically if PostgreSQL is reachable with the credentials in `.env`.

Tests never call Telegram, Cloudflare R2 or an AI provider.

To run only the tests that need no database or Redis:

```bash
pnpm --filter @creatorchat/api exec vitest run --project unit
pnpm --filter @creatorchat/db exec vitest run --project unit
```

## Configuration

All variables are documented in `.env.example` (server) and `apps/*/.env.example` (browser, `VITE_*` only). See [CONFIGURATION.md](CONFIGURATION.md) for what each one does.

- Without Telegram, R2 or AI credentials the API and worker still start and log which integrations are **unconfigured** (look for the `integration status` log line).
- Values like `<set-locally>` count as "not set".
- Never put a secret in a `VITE_*` variable: those are bundled into the browser.
- To try the real Mini App inside Telegram you need a public HTTPS URL (a tunnel or a domain). Picking and running one is your decision; nothing here publishes anything.

## Troubleshooting

- **`pnpm test` fails with "Cannot connect to PostgreSQL for tests"** — PostgreSQL isn't running, or the credentials in `.env` don't match. Fix `DATABASE_URL_TEST` or re-run `scripts/setup-postgres.sql`.
- **Health says `redis: down`** — Redis isn't running or `REDIS_URL` is wrong.
- **Port already in use** — change `API_PORT` in `.env`, or stop whatever holds 5173/5174 (the Vite apps use `--strictPort` on purpose, so CORS stays predictable).
- **After pulling schema changes** — run `pnpm db:migrate` and `pnpm db:generate`.

## Project documentation

Product brief, technical decisions, plans and QA reports live under `.agile/`. Start with `AGENTS.md`.
