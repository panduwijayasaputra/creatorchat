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
| Local infra | Docker Compose: PostgreSQL + Redis only; Node apps run via pnpm |

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
├── infra/
│   └── docker-compose.yml  # postgres + redis with named volumes + healthchecks
├── designs/creator-chat-design-handoff/design/   # read-only Claude Design handoff (png/, html/, DESIGN.md, INDEX.md)
├── .env.example            # Every variable documented, marked server/client
├── README.md               # Concrete local run steps (user is new to Docker)
├── AGENTS.md
└── .agile/                 # Agile pipeline (brief, guidelines, stories, plans, QA)
```

Architecture: **modular monolith**. `api` and `worker` are separate processes that share explicit services from `packages/backend-core` and the Prisma client from `packages/db`. No microservices.

## Target Root Scripts

To be implemented in Phase A (they don't exist until scaffolded):

```
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm db:migrate        # prisma migrate dev against the local DB
pnpm db:seed           # explicit fixtures; admin seed needs a supplied/generated password
pnpm dev               # api + worker + miniapp + admin in parallel
pnpm typecheck
pnpm lint
pnpm test              # unit + integration (no paid AI, no real Telegram/R2)
pnpm build
```

Stop: `docker compose -f infra/docker-compose.yml stop`. **Never** document `down -v` as a routine step — volumes hold user data.

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
| Pinned versions (Node, pnpm, NestJS, Prisma, React, Vite, BullMQ, grammY, Socket.IO) | TBD — Phase A | Verify against official docs |
| Runtime validation library for `packages/contracts` | Proposed: Zod | Confirm at scaffold; must serve api + frontends |
| Test runner | Proposed: Vitest for frontends/packages; API runner verified for NestJS decorator support | Confirm at scaffold |
| Mini App + admin router / server-state library | Proposed: React Router + TanStack Query | Handoff is static HTML (no JS), so no existing choice to follow |
| Component styling | Proposed: CSS Modules + global CSS-variable tokens | Confirm at scaffold |
| Inter font delivery | Proposed: self-hosted Inter 400/500/600/700 | Handoff uses Google Fonts; self-host only if visually identical |
| Visual regression | Playwright screenshots vs `design/png` | Decided 2026-11-14 (designer's handoff instructions) |
| Telegram WebApp SDK | TBD | Official `telegram-web-app.js` vs community SDK; check docs |
| AI provider/model | TBD — open input | Adapter + fake provider until chosen; admin UI names are samples |
| Upload size/format/duration limits | TBD — open input | Admin-configurable; don't hide assumptions |
| Product name, bot username, domains | TBD — open input | Placeholders only (design uses "Creator Chat", `CreatorChatBot` as samples) |
| Claude Design handoff location | Decided 2026-11-14 | `designs/creator-chat-design-handoff/design/` — see `design-integration.md` |
| Design vs brief conflicts (AI disclosure, AI memory, price, welcome message, blur gallery, timezone) | Decided 2026-11-14 | See "Resolved Conflicts" in `design-integration.md` |

## Testing

- Typecheck + lint + build per changed package.
- Unit tests for pure domain logic (entitlement windows, state transitions).
- **Integration tests against real PostgreSQL** (separate test database via Compose) for authorization, idempotency, transactions and concurrency — these matter more than getter tests.
- Fakes for Telegram API, AI provider, and R2 by default. Real integrations only when explicitly configured.
- Visual QA: Playwright screenshots at board sizes (`INDEX.md`) compared with `design/png/...` — miniapp 390 wide; admin 1440, 1024, 390.

## Deployment

Out of scope until instructed. Later: VPS + production Docker Compose running all components, TLS, off-host PostgreSQL backups with tested restore. No automated deployment.

---

**Important**: All agents MUST follow `backend.md` and `frontend.md` when generating code, and the brief for product rules.
