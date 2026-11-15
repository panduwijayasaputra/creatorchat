# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Current State

Phase A is under way. **US-001** (workspace, database baseline, health), **US-002** (design system + app shells) and **US-003** (admin login, session, logout) **US-004** (Mini App login with Telegram) and **US-005** (bot webhook and creator deep links; `pnpm telegram:webhook` connects a real bot) and **US-006** (`@Roles()` on every user route, `AccountSecurityService` for block / role change, role-gated Mini App shells) are built; the blocked-account message is placeholder copy until designed, and the socket connection check (`authorizeConnection`) waits for the Phase C gateway. The commands below exist (see `package.json`); `pnpm visual` is the Playwright screenshot comparison against the design PNGs (needs `pnpm exec playwright install chromium` once); `pnpm telegram:initdata` prints signed fake Telegram initData for trying the Mini App login locally (needs `TELEGRAM_BOT_TOKEN` and `USER_SESSION_SECRET` in `.env`); `pnpm admin:create` creates an admin or resets its password (needs `ADMIN_ACCESS_TOKEN_SECRET` / `ADMIN_REFRESH_TOKEN_SECRET` in `.env` before anyone can log in).

## Commands (targets — implemented in Phase A)

```bash
pnpm install
# PostgreSQL + Redis run natively (no Docker): README.md; create DBs with scripts/setup-postgres.sql
pnpm db:migrate          # prisma migrate dev — local dev DB only
pnpm db:seed             # fixtures from design seed data; admin password supplied/generated, shown once
pnpm dev                 # api + worker + miniapp + admin
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm --filter <api|worker|miniapp|admin|backend-core|contracts|db> test   # one package
```

Single-test syntax depends on the test runner chosen at scaffold (proposed Vitest: `pnpm --filter api test -- <file> -t "<name>"`). Integration tests (`*.int.spec.ts`) need the local PostgreSQL + Redis and use `DATABASE_URL_TEST`, never the dev DB. Env variables and the server/client split: `CONFIGURATION.md`.

## Architecture (big picture)

Modular monolith in a pnpm workspace:

- `apps/api` — NestJS on Fastify. User API under `/v1`, admin API under `/v1/admin` with separate guards and a separate principal (`AdminAccount`, password + JWT cookies). Also hosts the Socket.IO gateway and the grammY webhook.
- `apps/worker` — separate process running BullMQ processors: AI replies, media thumbnail/poster, broadcast fan-out, Telegram notifications, access reminders/expiry, welcome messages, plus the outbox reconciler.
- `packages/backend-core` — framework-light domain services shared by api and worker (entitlement check, message commit, AI commit, media authorization, outbox writes). They take a Prisma transaction client explicitly.
- `packages/contracts` — runtime schemas + types shared by api and both frontends (request/response, error codes, socket events). Change contracts first.
- `packages/db` — Prisma schema, migrations, seed.
- `apps/miniapp` (Telegram Mini App; USER and CREATOR shells, no role switcher) and `apps/admin` — React + Vite.

Cross-cutting flows that span several packages:

- **Auth:** Mini App posts Telegram `initData` → API validates HMAC/age → app session held in memory (re-exchanged on launch). Role and `session_version` are re-checked on sensitive operations and socket joins.
- **Write path:** HTTP only. Persist message in a transaction (idempotent via `client_message_id`) → write `OutboxEvent` → commit → dispatcher enqueues → worker. Socket.IO emits only committed events; clients refetch over HTTP after reconnect.
- **AI reply:** worker generates from persona + recent history of that conversation only (no memory/summaries), then commits in a transaction that locks the conversation and re-checks mode = AI, `response_version`, account status and active subscription. Manual send/takeover bumps the version, so stale AI results are discarded.
- **Access:** no payments; admins grant/extend/revoke subscriptions. Active entitlement is evaluated server-side on send, AI, gallery and broadcast delivery. Received attachments stay readable after expiry.
- **Media:** private R2 bucket, presigned upload → server verification → finalized `MediaAsset`. Gallery membership and message attachments are separate relations to one asset; signed read URLs are issued only after an ownership/entitlement check.

## Where Things Are Specified

| Need | File |
|---|---|
| Product rules | `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` |
| Design↔brief decisions that override the brief, design gaps, board→route maps, tokens, seed data | `.agile/guidelines/design-integration.md` |
| Backend patterns + authorization hard rules | `.agile/guidelines/backend.md` |
| Frontend patterns, Telegram + admin UI rules | `.agile/guidelines/frontend.md` |
| Stack, versions, decisions log | `.agile/guidelines/tech-stack.md` |
| What exists now | `.agile/guidelines/codebase-map.md` |

## Design Handoff

`designs/creator-chat-design-handoff/design/` is read-only: `png/{miniapp,admin}/<Board>.png` for the look, `html/<Board>.html` for exact values (static HTML, inline styles), `INDEX.md` for board sizes, `DESIGN.md` for tokens and patterns. Its own `CLAUDE.md` has been merged into `design-integration.md`. Per screen: view the PNG, copy values from the HTML, re-implement as React components (don't paste the HTML), then compare a Playwright screenshot at the board size with the PNG. The handoff's `DESIGN.md` is overruled where `design-integration.md` says so (e.g. no blurred gallery tiles, AI disclosure in the service description).
