# Technical Plan: US-001 — Workspace, local infrastructure, and database baseline

## Architecture Overview

Phase A foundation. No product behavior and no UI design; this slice makes everything after it buildable and testable. Vertical slice for this story: `packages/contracts` (error shape, error codes, health) → `packages/db` (identity-baseline migration) → `packages/backend-core` (env config, integration status) → `apps/api` (request ID, error filter, logging, health) → `apps/worker` / `apps/miniapp` / `apps/admin` (runnable shells).

Brief refs: §12 (stack), §13 (identity entities only), §14 (error contract), §16 steps 4–5, 8, §18 (env/ops). Design refs: none; seed samples from `DESIGN.md` → "Data sampel". Miniapp/admin shells are deliberately blank placeholders; real UI belongs to US-002.

### Decisions agreed with the user (2026-11-15)

| Topic | Decision |
|-------|----------|
| Existing leftovers (`apps/*/src`, `packages/*/dist`, root `node_modules`, no `package.json`/lockfile/source) | **Replace.** TASK-001 deletes them and scaffolds from scratch. They are untracked and contain no source. |
| Docker | **Not used** (user decision 2026-11-15). PostgreSQL and Redis run natively. The Compose file, `infra/` folder and all Docker wording were removed from code and docs; `scripts/setup-postgres.sql` creates the role and databases. Code only uses `DATABASE_URL`/`REDIS_URL`. |
| Validation library | **Zod** in `packages/contracts`, serving api + frontends. |
| Test runner | **Vitest** everywhere; API uses `unplugin-swc` for decorator metadata. |
| Worker bootstrap | **Plain Node + backend-core**, no Nest. |
| Versions | Pinned by the dev from official docs/compat tables (not from memory), recorded in `tech-stack.md`. |

Open for later stories (not blocking): Telegram WebApp SDK, router/server-state, styling, Inter delivery (all US-002+).

## Authorization & Data Rules

- No user-facing endpoint besides the unauthenticated `GET /v1/health`. It returns only `up`/`down` per dependency, no versions, hostnames, URLs, or error text.
- `/v1/admin` prefix is reserved and unrouted here; guards come in US-003.
- Identity tables follow the backend.md Data Model Rules: UUID PKs (`gen_random_uuid()`), `timestamptz`, `telegram_id` BigInt UNIQUE (serialized as string in JSON), explicit enums.
- `Session` belongs to **exactly one** of user/admin: DB `CHECK (num_nonnulls(user_id, admin_id) = 1)` (raw SQL in migration).
- `AuditLog` is append-only: a row-level `BEFORE UPDATE OR DELETE` DB trigger raises an exception (TRUNCATE is not trapped; the test harness uses it on the guarded test DB only). No update/delete code paths in services.
- Safety: test DB guard (below) makes it impossible for tests to run against dev data. Seed never prints/stores a default password; never runs in `production`.
- Logs: structured, request ID on every line, redaction of `authorization`, `cookie`, `set-cookie`, `x-telegram-*`, and any `initData`/`password`/`token`/`secret` field; **request/response bodies are never logged**.
- Idempotency/transactions/outbox/sockets: none yet (OutboxEvent and others are later phases; not created).

## Dependencies

- Tooling on machine: Node v24.18.1, pnpm 12.16.1. Native PostgreSQL 18 (Windows service) and Redis (Redis has no official Windows build → README documents Memurai or WSL2 Redis).
- Packages (exact versions to be pinned in TASK-001 after checking docs; record in decisions log): `typescript`, `@nestjs/*` + `@nestjs/platform-fastify` (Fastify major must match the adapter's supported range), `fastify`, `prisma` + `@prisma/client` (check Node 24 support and whether the installed major needs `prisma.config.ts`), `zod`, `ioredis`, `pino`/`nestjs-pino` (or Fastify native pino), `argon2` or `@node-rs/argon2` (seed hash; Windows prebuilt required), `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `vitest`, `unplugin-swc`, `@swc/core`, `eslint` + `typescript-eslint`, `prettier`, `tsx`, `dotenv-cli` (or Node `--env-file`).
- Not in this story (do not install): BullMQ, grammY, Socket.IO, Sharp, R2/AWS SDK, router, TanStack Query.
- Env vars: all from `CONFIGURATION.md`; this story actually consumes `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_URL_TEST`, `REDIS_URL`, `API_PORT`, `ALLOWED_ORIGINS`, plus seed-only `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`. Other variables are documented in `.env.example` and parsed as optional.
- Prior stories: none.

## Risks

- **Native-only local infra** — no Docker, so setup is manual. Mitigation: `scripts/setup-postgres.sql` (idempotent) plus README steps; the test harness creates the test database itself if the login works.
- **Redis on Windows** — no official build. Mitigation: README documents WSL2 (`redis-server`) or Memurai; `REDIS_URL` unchanged.
- **Peer/compat drift** (Nest ↔ Fastify, Prisma ↔ Node 24, Vite ↔ React). Mitigation: TASK-001 builds a version matrix from official docs before any code and records it; lockfile committed.
- **Internal packages consumed by apps** (build order, watch mode, ESM/CJS with Nest). Mitigation: packages compiled with `tsc` to `dist` (project references); `pnpm dev` first builds packages then runs watchers; dev picks module format (ESM or CJS) so Nest, Vite, and Prisma all load it, and records it.
- **Test DB safety** — an accidental run against dev data. Mitigation: guard refuses if `DATABASE_URL_TEST` equals `DATABASE_URL` or DB name does not end `_test`.
- **Seed password leakage** — Mitigation: password from `SEED_ADMIN_PASSWORD` or generated and printed once to stdout only (never logged/stored); existing admin is never overwritten.

## Tasks

### TASK-001: Workspace scaffold, tooling and pinned versions

Remove leftovers first. **Before deleting, list what exists** (`apps`, `packages/*/dist`, root `node_modules`) and confirm they contain no source (they were seen to contain none). Delete them. Then scaffold:

- Root `package.json` (`private`, `packageManager: pnpm@<pinned>`, `engines.node`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.npmrc` (`save-exact=true`), `.nvmrc`/`.node-version`, `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` optional), ESLint flat config (`no-explicit-any` as error), `.prettierrc`, `vitest.workspace` (or per-package configs), `.editorconfig`.
- Package skeletons with `package.json` (`name: @creatorchat/<x>`, single public entry via `exports`), `tsconfig.json` (extends base, `composite`), `src/index.ts`, `vitest.config.ts`: `packages/{db,contracts,backend-core,ui}`, `apps/{api,worker,miniapp,admin}`.
- Root scripts (final names): `typecheck`, `lint`, `test`, `build`, `build:packages`, `dev`, `db:generate`, `db:migrate`, `db:seed`, `format`. `dev` = build packages then `pnpm -r --parallel` run each app's `dev`. `test` runs all packages' Vitest, **serially for DB-touching suites** (single worker for integration project) to avoid test-DB races.
- Version matrix: read official docs, pin exact versions, commit `pnpm-lock.yaml`. Record in `tech-stack.md` decisions log: pinned versions, Zod, Vitest (+SWC for API), plain-bootstrap worker, native-vs-Docker local infra decision, module format. Mark rows that were TBD as Decided with date.
- Confirm `.gitignore` covers `node_modules`, `dist`, `.env`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| DELETE | `apps/**`, `packages/*/dist`, `node_modules` (leftovers) | Clean slate |
| CREATE | `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.node-version`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.editorconfig`, `pnpm-lock.yaml` | Workspace + tooling |
| CREATE | `packages/{db,contracts,backend-core,ui}/{package.json,tsconfig.json,src/index.ts}` | Package skeletons |
| CREATE | `apps/{api,worker,miniapp,admin}/{package.json,tsconfig.json}` | App skeletons |
| MODIFY | `.agile/guidelines/tech-stack.md` | Decisions log + pinned versions |

**Testing:**
- `pnpm install --frozen-lockfile` works from clean clone; `pnpm typecheck`, `pnpm lint`, `pnpm build` pass on skeletons; `pnpm test` passes (a trivial test per package is fine until real tests land).

---

### TASK-002: Local infrastructure and env examples

- `scripts/setup-postgres.sql`: idempotent creation of role `creatorchat` and databases `creatorchat` + `creatorchat_test` for native PostgreSQL. (Docker Compose was dropped by user decision.)
- `.env.example` (root) exactly per `CONFIGURATION.md`: every variable with placeholder, grouped, each marked server-only; Telegram/R2/AI blank or `<set-locally>`; `AI_PROVIDER=fake`; plus `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` (commented). `apps/miniapp/.env.example` and `apps/admin/.env.example`: `VITE_API_BASE_URL`, `VITE_TELEGRAM_BOT_USERNAME` (miniapp only). No other vars, no secrets.
- Native path defaults: same URLs, `localhost:5432` / `localhost:6379`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `scripts/setup-postgres.sql` | Local role + dev/test databases |
| CREATE | `.env.example` | Server vars |
| CREATE | `apps/miniapp/.env.example`, `apps/admin/.env.example` | Public `VITE_*` only |

**Testing:**
- Test (unit): every key in `.env.example` files is documented in `CONFIGURATION.md` and no `VITE_*` key matches `/SECRET|TOKEN|KEY|PASSWORD/i`.

---

### TASK-003: Contracts — error shape, error codes, health

In `packages/contracts/src/`:
- `errors.ts`: `ErrorCode` const object (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`) + `ErrorCodeSchema`; `ErrorResponseSchema = z.object({ code, message: string, request_id: string, details?: unknown })`; inferred type `ErrorResponse`.
- `health.ts`: `DependencyStatusSchema = z.enum(['up','down'])`; `HealthResponseSchema = { status: 'ok'|'degraded', checks: { db, redis } }`.
- `ids.ts`: `TelegramIdSchema` (string of digits, ≤ 20 chars; BigInt ↔ string helper `telegramIdToString` / `parseTelegramId`) so the string-in-JSON rule exists from the start.
- `index.ts` re-exports. No deep imports allowed by other packages.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/{errors,health,ids,index}.ts` | Shared schemas |
| CREATE | `packages/contracts/src/*.spec.ts` | Unit tests |
| MODIFY | `packages/contracts/package.json` | `zod` dep, exports |

**Testing:**
- Error/health schemas accept valid and reject missing `request_id`, unknown `status`, extra-typed `details` ok.
- Telegram ID helper round-trips values beyond `Number.MAX_SAFE_INTEGER`; rejects non-numeric, negative, empty.

---

### TASK-004: Prisma identity-baseline migration

In `packages/db`: Prisma schema + first migration (generated with `migrate dev` against the **local dev DB only**, then committed; add a raw-SQL section in the same migration for what Prisma cannot express). Model names PascalCase, mapped to snake_case tables/columns via `@@map`/`@map`.

Enums: `Role {USER, CREATOR}`, `AccountStatus {ACTIVE, BLOCKED}`, `AdminStatus {ACTIVE, DISABLED}`, `AuditActorType {ADMIN, USER, SYSTEM}`.

Models (all ids `@db.Uuid @default(dbgenerated("gen_random_uuid()"))`, all timestamps `@db.Timestamptz(3)`):
- `User`: `id`, `telegramId BigInt @unique`, `role Role @default(USER)`, `status AccountStatus @default(ACTIVE)`, `displayName String`, `telegramUsername String?` (mutable, never identity), `avatarUrl String?`, `bio String?`, `timezone String @default("Asia/Jakarta")` (IANA), `sessionVersion Int @default(1)`, `createdAt`, `updatedAt`. Profile fields are the minimum; later stories (Phase B) extend by migration.
- `AdminAccount`: `id`, `username String @unique` (stored lowercase; check constraint `username = lower(username)`), `passwordHash String`, `status AdminStatus @default(ACTIVE)`, `createdAt`, `updatedAt`.
- `Session`: `id`, `userId String? → User`, `adminId String? → AdminAccount`, `refreshTokenHash String @unique` (SHA-256 hex of an opaque token; plain token never stored), `expiresAt`, `revokedAt?`, `lastUsedAt?`, `createdAt`. `onDelete: Restrict`. Indexes: `(userId)`, `(adminId)`, `(expiresAt)`. Raw SQL: `CHECK (num_nonnulls(user_id, admin_id) = 1)`.
- `AuditLog`: `id`, `actorType AuditActorType`, `actorId String? @db.Uuid` (polymorphic, no FK), `action String`, `targetType String?`, `targetId String?`, `reason String?`, `changes Json?` (sanitized before/after), `requestId String?`, `createdAt`. Indexes: `(createdAt)`, `(targetType, targetId)`. Raw SQL: trigger function `audit_log_append_only()` raising an exception on `BEFORE UPDATE OR DELETE` row-level on `audit_log`.
- Nothing for Creator, Subscription, Conversation, etc. (later phases).

Scripts in `packages/db`: `generate`, `migrate:dev`, `migrate:deploy`, `seed`. Export a singleton-safe `createPrismaClient(url?)` and re-export generated types from `src/index.ts` (single public entry). `db:migrate` at root = `prisma migrate dev`; test harness uses `migrate deploy`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/schema.prisma` | Identity baseline |
| CREATE | `packages/db/prisma/migrations/<ts>_identity_baseline/migration.sql` | Migration incl. CHECKs + trigger |
| CREATE | `packages/db/prisma.config.ts` (if the pinned Prisma major requires it) | Schema/migration paths, `DATABASE_URL` |
| CREATE | `packages/db/src/{client,index}.ts` | Client factory + exports |

**Testing:** (in TASK-006 harness, `*.int.spec.ts`)
- Duplicate `telegram_id` rejected; `telegram_id` > 2^53 stored and read back exactly.
- Defaults: new user is `USER`/`ACTIVE`, `session_version = 1`.
- Session with both or neither of `user_id`/`admin_id` rejected by CHECK; duplicate `refresh_token_hash` rejected.
- `AuditLog` insert works; `UPDATE` and `DELETE` raise; admin `username` with uppercase rejected.
- `prisma migrate deploy` on an empty DB succeeds and creates only the four tables (+ `_prisma_migrations`).

---

### TASK-005: backend-core — env config and integration status

In `packages/backend-core/src/config/`:
- `env.ts`: Zod schema for server env (per `CONFIGURATION.md`): required `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`; defaults `LOG_LEVEL=info`, `API_PORT=3000`; `ALLOWED_ORIGINS` parsed to `string[]`; everything else (`TELEGRAM_*`, `R2_*`, `AI_*`, secrets) optional. Placeholder values like `<set-locally>` are treated as **unset**. `loadEnv(source = process.env): ServerEnv` throws a readable error listing invalid **keys only (never values)**.
- `integrations.ts`: `getIntegrationStatus(env): { telegram, r2, ai }` each `'configured' | 'unconfigured'`; AI `fake` counts as `'unconfigured'` with `provider: 'fake'` note. Pure function, no secret values returned.
- `logging.ts`: exported `REDACT_PATHS` and `redactLogFields` used by api + worker loggers.
- Production guard: `NODE_ENV=production` requires non-empty `USER_SESSION_SECRET`, `ADMIN_ACCESS_TOKEN_SECRET`, `ADMIN_REFRESH_TOKEN_SECRET` (each ≥ 32 chars, mutually distinct) and `MASTER_ENCRYPTION_KEY`; dev does not.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/config/{env,integrations,index}.ts` | Config |
| CREATE | `packages/backend-core/src/logging/{redact,index}.ts` | Redaction |
| CREATE | `packages/backend-core/src/**/*.spec.ts` | Unit tests |
| MODIFY | `packages/backend-core/src/index.ts` | Public entry |

**Testing:**
- Missing `DATABASE_URL` → error names the key, message contains no secret value.
- Placeholder `<set-locally>` bot token → `telegram: 'unconfigured'`; real-looking value → `'configured'`, and status object never contains the value.
- Production with duplicated/short secrets rejected; development with none accepted.
- `redactLogFields` masks `authorization`, `cookie`, `initData`, `password`, `*token*`, `*secret*` at any depth.

---

### TASK-006: Test harness with isolated test database

- `vitest` integration project (`*.int.spec.ts`) separate from unit (`*.spec.ts`); integration runs serially (`fileParallelism: false`/single fork).
- `packages/db/test/global-setup.ts` (shared via a helper export for api tests): load `DATABASE_URL_TEST`; **`assertSafeTestDatabase(testUrl, devUrl)`** — throws if equal, if DB name doesn't end with `_test`, or if host isn't local (`localhost`/`127.0.0.1`/`::1`); `ensureTestDatabase()` connects to the `postgres` maintenance DB and `CREATE DATABASE` if missing; then `prisma migrate deploy` against the test DB.
- Helpers: `resetDatabase(prisma)` — `TRUNCATE` all app tables `RESTART IDENTITY CASCADE` **except** that AuditLog's trigger doesn't cover TRUNCATE; use it only on the test DB (guard re-checked inside the helper). `createTestPrisma()`.
- Root `pnpm test` fails fast with a clear message when `DATABASE_URL_TEST` is unset or Postgres unreachable (not a cryptic stack).
- Write the DB integration tests listed in TASK-004 here.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/src/testing/{safe-database,test-db,index}.ts` (exported via a `./testing` subpath export; documented exception to single-entry rule) | Guard + helpers |
| CREATE | `packages/db/test/global-setup.ts`, `packages/db/vitest.config.ts` | Setup |
| CREATE | `packages/db/test/identity-baseline.int.spec.ts` | Schema constraint tests |
| CREATE | `packages/db/src/testing/safe-database.spec.ts` | Guard unit tests |

**Testing:**
- Guard: same URL as dev → throws; `creatorchat` (no `_test`) → throws; remote host → throws; `creatorchat_test` on localhost → ok.
- Running `pnpm test` leaves a pre-inserted row in the **dev** database untouched (verified manually once and noted in QA).

---

### TASK-007: API bootstrap — request ID, error contract, logging, health

`apps/api` (NestJS on Fastify adapter, `/v1` global prefix):
- `src/main.ts`: load env via `loadEnv`; Fastify adapter with `genReqId` (accept inbound `x-request-id` only if `/^[A-Za-z0-9._-]{8,64}$/`, else `randomUUID()`), `bodyLimit` set (e.g. 1 MiB; media is separate later), CORS using `ALLOWED_ORIGINS` allowlist (no wildcard), `trustProxy` off by default, graceful shutdown hooks, log integration status (configured/unconfigured per integration, no values) and listen on `API_PORT`.
- Logging: Fastify's pino logger configured with `REDACT_PATHS`, serializers that drop bodies; every log line carries `reqId`/`request_id`; response header `x-request-id`.
- `common/errors/app-error.ts`: `class AppError(code: ErrorCode, httpStatus: number, message: string, details?: unknown)`. `common/errors/all-exceptions.filter.ts`: maps `AppError`, Nest `HttpException` (incl. 404 unknown route, 413, 400 JSON parse), Zod errors (→ `VALIDATION_FAILED` 400 with `details` = field paths/messages, no input echo), and everything else (→ `INTERNAL_ERROR` 500, generic message, full error logged with request ID, **never** stack/Prisma text in the response). Body always `ErrorResponse` from contracts.
- `common/validation/zod-validation.pipe.ts`: validates with a contracts schema, throws validation `AppError`.
- `common/request-id/`: helper exposing the request id to filter/services.
- `modules/health/health.controller.ts`: `GET /v1/health`, no auth, `@Get()`; calls `HealthService`. `health.service.ts`: `SELECT 1` through Prisma and Redis `PING`, each with ~2 s timeout, never throws; response `HealthResponse` (200 when both up, 503 with `status: 'degraded'` and same shape when either is down). No error text, hostnames, or versions in the body; failure reason logged server-side only.
- Providers: `PrismaService` (wraps `createPrismaClient`, connect/disconnect lifecycle) and `RedisService` (ioredis, `lazyConnect`, `maxRetriesPerRequest` small so health doesn't hang). Both in `common/` or an `infra` module. Reserve folders per backend.md as empty only if needed (don't add placeholder files).
- Scripts: `dev` (watch, SWC), `build`, `start`, `test`. Vitest with `unplugin-swc` so decorators work.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/{main,app.module}.ts` | Bootstrap |
| CREATE | `apps/api/src/common/errors/{app-error,all-exceptions.filter}.ts` | Error contract |
| CREATE | `apps/api/src/common/validation/zod-validation.pipe.ts` | Contract validation |
| CREATE | `apps/api/src/common/request-id/request-id.ts` | Request ID helpers |
| CREATE | `apps/api/src/common/infra/{prisma,redis}.service.ts` | DB/Redis providers |
| CREATE | `apps/api/src/modules/health/{health.module,health.controller,health.service}.ts` | Health |
| CREATE | `apps/api/vitest.config.ts`, `apps/api/test/*.int.spec.ts`, `*.spec.ts` | Tests |

**Testing:** (use Nest testing + Fastify `inject`; real test DB and Redis)
- `GET /v1/health` → 200 `{status:'ok',checks:{db:'up',redis:'up'}}`, passes `HealthResponseSchema`, contains no URL/credential strings.
- With DB unreachable (invalid URL in a second app instance) → 503 `degraded`, `db:'down'`, body leaks no error text; same for Redis.
- Unknown route → 404 `{code:'NOT_FOUND', message, request_id}`; `request_id` equals `x-request-id` response header; a valid inbound `x-request-id` is echoed; an invalid/oversized one is replaced.
- Thrown unexpected error → 500 `INTERNAL_ERROR` generic message, no stack; the log line has the same request ID.
- Validation error via pipe → 400 `VALIDATION_FAILED`, `details` has no echoed raw input values.
- Log capture test: send request with `Authorization`, `Cookie`, and a body containing `initData`/`password`; captured logs contain none of those values and no body.
- Payload above `bodyLimit` → 413 with error contract.
- CORS: disallowed origin gets no `access-control-allow-origin`; allowed origin does.

---

### TASK-008: Seed fixtures

`packages/db/seed/seed.ts`, run by `pnpm db:seed` (root script loads `.env`):
- Refuses when `NODE_ENV=production`, and refuses to run against a database name ending `_test` unless `--allow-test` (tests use their own helpers) — print the target DB name (no credentials) before writing.
- **Admin:** username from `SEED_ADMIN_USERNAME` (default `admin`), password from `SEED_ADMIN_PASSWORD` or, if unset, a generated 24-char random password **printed once to stdout** with a "store it now" notice. Hash with Argon2id (OWASP-style params recorded in a constant; US-003 will reuse/extract them). If the admin already exists, leave it untouched and print "exists, password unchanged".
- **Fixture users** (all clearly fake Telegram IDs in a reserved range, e.g. `9_000_000_001+`, so they can't collide with real accounts): creators-to-be as `role: CREATOR`: Salsa, Kirana, Dinda; customers as `USER`: Maya Lestari, Raka Putra, Luna Aurora. Idempotent via upsert on `telegram_id`; re-running creates no duplicates and does not reset `session_version`. Only identity tables exist, so no subscriptions/creators profile rows (Raka's active-subscription sample is added by the Phase C seed).
- Seed code lives in `packages/db` and does not import `backend-core` (avoids a dependency cycle).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/seed/{seed,fixtures,admin}.ts` | Seed runner |
| CREATE | `packages/db/seed/*.int.spec.ts` | Seed tests (against test DB) |
| MODIFY | `packages/db/package.json`, root `package.json` | `db:seed` script |

**Testing:**
- Seeding twice yields exactly one admin and six users; second run prints "exists" and the admin hash is unchanged.
- Supplied password verifies with Argon2; generated password is not written to DB in plaintext, not present in any log output other than the single stdout notice (captured and asserted once).
- `NODE_ENV=production` → exit non-zero, no writes.
- Seeded users: roles as specified, all `ACTIVE`, `telegram_id` in reserved range.

---

### TASK-009: Worker shell

`apps/worker` as plain Node (no Nest): `src/main.ts` loads env with `loadEnv`, creates Prisma client and ioredis connection, logs integration status (same structured logger/redaction), logs ready, keeps running with a lightweight liveness loop that re-pings DB/Redis at an interval and logs state **changes** only, handles `SIGINT`/`SIGTERM` by closing connections. Reserve `src/processors/` and `src/outbox/` only when stories need them (no empty placeholder code). No BullMQ yet.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/worker/src/{main,logger}.ts` | Runnable worker |
| CREATE | `apps/worker/src/main.spec.ts` (boot helper unit-tested) | Tests |

**Testing:**
- Starts with only DB+Redis configured (no Telegram/R2/AI) and logs those three as unconfigured.
- Exits non-zero with a readable message when `DATABASE_URL` is missing (no values printed).
- Graceful shutdown closes both connections (test with fake clients).

---

### TASK-010: Mini App and admin shells

Minimal Vite + React apps, **not** design work (US-002 owns tokens, fonts, shells, router):
- `apps/miniapp` (port 5173) and `apps/admin` (port 5174, `--strictPort`): `index.html`, `src/main.tsx`, `src/App.tsx` rendering a plain unstyled "CreatorChat Mini App/Admin — setup OK" page that calls `GET {VITE_API_BASE_URL}/v1/health` and shows `up`/`down` text (validated with `HealthResponseSchema`; failures shown as "API unreachable", no crash).
- `vite.config.ts` with `@vitejs/plugin-react`; `vite-env.d.ts` typing only `VITE_API_BASE_URL` (+ `VITE_TELEGRAM_BOT_USERNAME` for miniapp).
- `packages/ui`: leave exporting nothing meaningful (placeholder `export {}`), only present so the workspace resolves; no components until reuse exists.
- Do not add a router, query library, fonts, or Telegram SDK.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/miniapp/{index.html,vite.config.ts,src/{main,App,vite-env.d}.ts*}` | Mini App shell |
| CREATE | `apps/admin/{index.html,vite.config.ts,src/{main,App,vite-env.d}.ts*}` | Admin shell |
| CREATE | `apps/*/src/App.spec.tsx` | Component tests (Vitest + jsdom or happy-dom) |

**Testing:**
- Renders "up" when health mock returns ok; "API unreachable" on network error/503; no thrown render errors.
- Build output contains no env var other than `VITE_*` (grep the built bundle for `DATABASE_URL`, `SECRET`).

---

### TASK-011: README, docs sync and end-to-end clean-clone verification

- `README.md`: prerequisites (Node, pnpm, **native PostgreSQL + Redis (no Docker)**, with exact native Windows steps incl. creating `creatorchat` and `creatorchat_test` DBs and Redis options), the command sequence from the story (`pnpm install`, copy env files, start infra, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`), ports/URLs, how to read the seed's one-time admin password, how to run tests, how to stop (`docker compose … stop`), and a prominent warning against `down -v` (it deletes the DB volume). Explain that Telegram/R2/AI are optional in dev and how to see which are unconfigured; mention HTTPS/tunnel is the user's decision (CONFIGURATION.md).
- Sync docs: `codebase-map.md` (structure → implemented, entities `User`, `AdminAccount`, `Session`, `AuditLog`, `GET /v1/health`, scripts, current state date), `backend.md` "Running" section with real commands, `CONFIGURATION.md` if names changed, `tech-stack.md` target scripts → actual.
- Final verification pass from a fresh clone (or `git clean`-style fresh copy): `pnpm install --frozen-lockfile` → `typecheck` → `lint` → `build` → `test` → migrate → seed → `dev` → `curl /v1/health` → both frontends load. Record results (and anything not verifiable) in the story's QA notes.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `README.md` | Concrete local run steps |
| MODIFY | `.agile/guidelines/{codebase-map,backend,tech-stack}.md`, `CONFIGURATION.md` | Doc sync |

**Testing:**
- A scripted smoke check (`pnpm verify:local` or documented manual list) that runs health + both frontends on their ports. Docs reviewed against the real command output.

---
