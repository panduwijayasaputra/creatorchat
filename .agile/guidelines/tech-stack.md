# Tech Stack Overview

Product rules live in `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` (the **brief**). This file summarizes the agreed stack (brief §12) and records decisions made at scaffold time.

## Agreed Stack

| Area | Choice |
|------|--------|
| Language | TypeScript end-to-end (strict mode) |
| Monorepo | pnpm workspaces |
| API | NestJS on the Fastify adapter, REST under `/v1`, admin under `/v1/admin` |
| Realtime | Socket.IO (committed events only; HTTP is the write path) |
| Jobs | BullMQ + Redis, in a separate `apps/worker` process |
| Database | PostgreSQL + Prisma (migrations committed) |
| Media | Cloudflare R2, private bucket, short-lived signed URLs |
| Media processing | Sharp / FFmpeg server-side for thumbnails/posters and format checks (no HLS) |
| Telegram bot | grammY, webhook mode with secret validation |
| Mini App | React + Vite, Telegram WebApp runtime |
| Admin | React + Vite, separate app |
| UI | Claude Design handoff re-implemented 1:1 as React components; CSS-variable tokens, Inter, inline SVG icons; no Tailwind/shadcn/UI library (the design uses none) |
| Visual QA | Playwright screenshots at board sizes compared with handoff PNGs |
| Local infra | Native PostgreSQL + Redis on the dev machine (no Docker); Node apps run via pnpm |

**Versions:** do not pick versions from memory. At scaffold time check official docs/compatibility (NestJS ↔ Fastify adapter ↔ Socket.IO adapter, Prisma ↔ Node, BullMQ ↔ Redis, React ↔ Vite), pin exact versions, commit `pnpm-lock.yaml`, and record them below.

## Repository Structure

The design handoff stays untouched in `designs/` as reference; apps re-implement it.

```
CreatorChat/
├── apps/
│   ├── miniapp/            # React + Vite Telegram Mini App (USER + CREATOR UIs)
│   ├── admin/              # React + Vite admin dashboard
│   ├── api/                # NestJS + Fastify HTTP API, Socket.IO gateway, bot webhook
│   └── worker/             # BullMQ processors + outbox reconciler
├── packages/
│   ├── db/                 # Prisma schema, migrations, generated client, seed scripts
│   ├── contracts/          # Shared request/response schemas + types, socket event types, error codes
│   ├── backend-core/       # Framework-light domain services shared by api + worker
│   └── ui/                 # Only components genuinely shared by miniapp + admin (extracted from export)
├── scripts/
│   └── setup-postgres.sql  # creates the local role + dev/test databases
├── designs/creator-chat-design-handoff/design/   # read-only Claude Design handoff (png/, html/, DESIGN.md, INDEX.md)
├── .env.example            # Every variable documented, marked server/client
├── README.md               # Concrete local run steps (native PostgreSQL/Redis setup)
├── AGENTS.md
└── .agile/                 # Agile pipeline (brief, guidelines, stories, plans, QA)
```

Architecture: **modular monolith**. `api` and `worker` are separate processes that share explicit services from `packages/backend-core` and the Prisma client from `packages/db`. No microservices.

## Target Root Scripts

To be implemented in Phase A (they don't exist until scaffolded):

```
pnpm install
pnpm db:migrate        # prisma migrate dev against the local DB
pnpm db:seed           # explicit fixtures; admin seed needs a supplied/generated password
pnpm dev               # api + worker + miniapp + admin in parallel
pnpm typecheck
pnpm lint
pnpm test              # unit + integration (no paid AI, no real Telegram/R2)
pnpm build
```

No Docker: PostgreSQL and Redis run natively (see README). Never run `DROP DATABASE` / `migrate reset` on a database you did not create for the task.

## API Communication

- REST JSON under `/v1`; admin under `/v1/admin` with independent guards.
- Errors: `{ "code": string, "message": string, "request_id": string, "details"?: ... }`.
- Telegram IDs are `bigint` in DB and **strings** in JSON.
- Cursor pagination for chat; offset/page (10/25/50) with total for admin tables.
- Mini App auth: Telegram `initData` validated server-side → app session.
- Admin auth: username/password → short-lived access JWT + rotating refresh token in Secure/HttpOnly cookies, CSRF protection.
- Socket.IO: rooms derived server-side; client never chooses its room by ID.

## Decisions Log

Record each decision with date when made. `TBD` items must be resolved (with the user if needed) before code depends on them.

| Decision | Status | Notes |
|----------|--------|-------|
| Pinned versions | Decided 2026-11-15 (US-001) | See "Pinned Versions" below. BullMQ, grammY, Socket.IO stay TBD until their stories |
| Runtime validation library for `packages/contracts` | Decided 2026-11-15 | Zod 4 |
| Test runner | Decided 2026-11-15 | Vitest everywhere; API uses `unplugin-swc` for decorator metadata |
| Module format | Decided 2026-11-15 | ESM everywhere (`"type": "module"`, `NodeNext`); NestJS 12 is ESM-only. Internal packages compile with `tsc` to `dist` and are consumed through `exports`; relative imports use `.js` extensions |
| Worker bootstrap | Decided 2026-11-15 | Plain Node + `backend-core`, no Nest |
| Local infra on this machine | Decided 2026-11-15 | User runs **native** PostgreSQL 18 (Windows service) and Redis; **Docker is not used** (user decision 2026-11-15, supersedes brief §12/§16 Compose wording; the `infra/` folder and Compose file were removed). Code only uses `DATABASE_URL` / `REDIS_URL` |
| API dev run | Decided 2026-11-15 | `tsc -w` + `node --watch dist/main.js` (tsc emits decorator metadata; esbuild/tsx does not) |
| Mini App + admin router / server-state library | Decided 2026-11-15 (US-002) | React Router now (shell navigation); TanStack Query is added by the first story that needs API data |
| Package sharing for UI | Decided 2026-11-15 (US-002) | `packages/ui` is source-only (exports point at `src`, no dist); consumed and compiled by Vite/Vitest in each app |
| Component styling | Decided 2026-11-15 (US-002) | CSS Modules + one global tokens.css in `packages/ui`; no Tailwind/shadcn/UI library |
| Inter font delivery | Decided 2026-11-15 (US-002) | Self-hosted Inter 400/500/600/700 (latin) via `@fontsource/inter`; same typeface as the boards |
| Visual regression | Decided 2026-11-14; tooling 2026-11-15 (US-002) | Playwright (`@playwright/test`, root devDependency, `pnpm visual`) screenshots vs `design/png`; human review of side-by-side sheets, no pixel threshold in CI |
| Icons | Decided 2026-11-15 (US-002) | Inline SVG React components copied from the boards (custom set, not Lucide) |
| Admin lockout storage | Decided 2026-11-15 (US-003) | Redis counters per normalized username (5 failures → 15 min lock) + per-IP limiter; fails closed if Redis is down |
| Admin access token library | Decided 2026-11-15 (US-003) | `jose` (HS256, algorithm pinned); version pinned at install |
| Admin dev topology + CSRF | Decided 2026-11-15 (US-003) | Admin Vite dev server proxies `/v1` to the API (same-origin); Origin allowlist + double-submit `X-CSRF-Token`; cookies HttpOnly, path-scoped (`cc_admin_at` `/v1/admin`, `cc_admin_rt` `/v1/admin/auth`) |
| Admin client data layer | Decided 2026-11-15 (US-003) | fetch client + AuthProvider; TanStack Query still deferred to the first list screen |
| Telegram WebApp SDK | Decided 2026-11-15 (US-004) | Official `telegram-web-app.js` script in the Mini App `index.html` + a thin typed wrapper (`src/telegram/`); no npm SDK |
| Mini App session token | Decided 2026-11-15 (US-004) | HS256 JWT (`jose`, `USER_SESSION_SECRET`) in memory, Bearer header, 60 min, no refresh; re-exchange `initData` on expiry/reopen; every request re-checks the session row, status and `session_version` |
| Local Telegram login testing | Decided 2026-11-15 (US-004) | Real HMAC validation always; `pnpm telegram:initdata` signs fake initData with the local token and the dev-only `?tgdev=` loads it; no bypass endpoint |
| Telegram profile photo | Decided 2026-11-15 (US-004) | `photo_url` stored once in `users.avatar_url` at creation (hot-linked); R2 copy deferred to the media phase |
| Bot deep-link transport (US-005) | Decided 2026-11-15 | Bot `web_app` button opens `MINIAPP_URL/creators/<public_code>`; the path survives login (router sits under `AuthProvider`); the bot accepts only `^c_[A-Za-z0-9_-]{1,62}$`, else opens without a destination |
| `public_code` format (US-005) | Decided 2026-11-15 | 8 chars lowercase base32 (`a-z2-7`), server-generated, immutable, UNIQUE; readable slug deferred to the creator profile |
| Webhook handling (US-005) | Decided 2026-11-15 | grammY 1.46.0 (pinned), secret header checked in constant time before parsing, webhook reply (no inline Bot API call), `botInfo` from config (no `getMe`); BullMQ not needed until Phase E |
| Roles and session invalidation (US-006) | Decided 2026-11-15 | `@Roles()` + `RolesGuard` (fail closed) on every user route; `AccountSecurityService` is the single writer of account status/role and bumps `session_version`, revokes sessions and audits; no Socket.IO yet, so the connection rule is a framework-free `authorizeConnection()` the Phase C gateway must call |
| Bot copy (US-005) | Placeholder — open input | Undesigned Indonesian placeholder copy in one constants file; user supplies final wording |
| AI provider/model | TBD — open input | Adapter + fake provider until chosen; admin UI names are samples |
| Upload size/format/duration limits | TBD — open input | Admin-configurable; don't hide assumptions |
| Product name, bot username, domains | TBD — open input | Placeholders only (design uses "Creator Chat", `CreatorChatBot` as samples) |
| Claude Design handoff location | Decided 2026-11-14 | `designs/creator-chat-design-handoff/design/` — see `design-integration.md` |
| Design vs brief conflicts (AI disclosure, AI memory, price, welcome message, blur gallery, timezone) | Decided 2026-11-14 | See "Resolved Conflicts" in `design-integration.md` |

### Pinned Versions (2026-11-15)

Checked against the npm registry and each package's `peerDependencies`/`engines` (Node 24 on the dev machine). Pinned exactly in `package.json`; `pnpm-lock.yaml` is committed.

| Package | Version | Compatibility note |
|---------|---------|--------------------|
| Node / pnpm | 24.x / 12.16.1 | `engines.node >=24` |
| typescript | 6.0.3 | typescript-eslint 8.72.2 peers `<6.1.0`, so TS 7 is not used |
| @nestjs/common, core, platform-fastify, testing | 12.5.0 | ESM-only; platform-fastify bundles fastify 5.12.8 and @fastify/cors |
| prisma, @prisma/client, @prisma/adapter-pg | 7.10.1 | Node 24 supported; Prisma 7 needs `prisma.config.ts` and a driver adapter (`pg` 8.23.1). `prisma@8` is still rc, so not used |
| zod | 4.6.7 | |
| ioredis | 6.0.0 | |
| pino | 10.4.0 | |
| argon2 | 0.45.2 | native prebuild; build script approved in `pnpm-workspace.yaml` |
| react, react-dom | 19.3.1 | |
| vite / @vitejs/plugin-react | 8.3.8 / 6.3.0 | plugin-react 6 requires vite ^8 |
| vitest | 5.1.0 | peer vite ^6.4, ^7 or ^8 |
| unplugin-swc / @swc/core | 2.0.0 / 1.16.22 | |
| eslint / typescript-eslint | 10.15.0 / 8.72.2 | flat config |
| prettier | 3.10.1 | |
| tsx / concurrently | 4.23.15 / 9.2.1 | dev tooling only |
| react-router | 8.5.1 | Shell navigation (miniapp, admin); import `RouterProvider` from `react-router/dom` |
| @fontsource/inter | 5.3.0 | Self-hosted Inter, latin 400/500/600/700 |
| @playwright/test | 1.65.1 | Root devDependency, `pnpm visual`; Chromium installed locally |
| @testing-library/react / dom / user-event / jest-dom | 16.3.3 / 10.4.2 / 14.6.10 / 7.0.1 | Component tests |
| jsdom | 31.0.1 | Vitest environment |
| jose | 6.2.17 | Admin access JWT (HS256), in `packages/backend-core` (and as a test-only devDependency of `apps/api`); checked against the npm registry 2026-11-15 |
| @fastify/cookie | 11.1.5 | Cookie parsing/setting for the API (Fastify 5 compatible), `apps/api` |

| grammy | 1.46.0 | US-005, `apps/api` only (webhook, `webhookCallback(bot, 'fastify')`); checked against the npm registry 2026-11-15 (engines node >=14.13); its types package is @grammyjs/types 5.0.0 |

Not yet installed: BullMQ, Socket.IO, Sharp, R2/AWS SDK, TanStack Query (their stories). `backend-core` now also depends on `@creatorchat/db` (Prisma client types) and has `ioredis` as a test-only devDependency.

## Testing

- Typecheck + lint + build per changed package.
- Unit tests for pure domain logic (entitlement windows, state transitions).
- **Integration tests against real PostgreSQL** (separate test database) for authorization, idempotency, transactions and concurrency — these matter more than getter tests.
- Fakes for Telegram API, AI provider, and R2 by default. Real integrations only when explicitly configured.
- Visual QA: Playwright screenshots at board sizes (`INDEX.md`) compared with `design/png/...` — miniapp 390 wide; admin 1440, 1024, 390.

## Deployment

Out of scope until instructed. Later: VPS running all components, TLS, off-host PostgreSQL backups with tested restore. No automated deployment.

---

**Important**: All agents MUST follow `backend.md` and `frontend.md` when generating code, and the brief for product rules.
