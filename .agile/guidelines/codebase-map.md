# Codebase Map

> Overview of what **actually exists** in the CreatorChat repo. Keep in sync when adding entities, endpoints, routes, or design screens. Planned items are marked _planned_ until implemented.

## Current State (2026-11-14)

- No application code yet. Repo contains the agile pipeline (`.agile/`, `.claude/commands/`), `AGENTS.md`, `CLAUDE.md`, `CONFIGURATION.md`, `.gitignore`, and the design handoff.
- **Claude Design handoff present** at `designs/creator-chat-design-handoff/design/` (173 boards). Board → route maps, tokens, resolved conflicts and gaps: `design-integration.md`.
- Next step: Phase A — Foundation (workspace scaffold, Compose, Prisma baseline, design tokens + shared components, Telegram auth, bot entry, admin login, roles).

## Project Structure (target — see `tech-stack.md`)

```
apps/miniapp        _planned_  React + Vite Telegram Mini App
apps/admin          _planned_  React + Vite admin dashboard
apps/api            _planned_  NestJS + Fastify API, Socket.IO, bot webhook
apps/worker         _planned_  BullMQ processors + outbox reconciler
packages/db         _planned_  Prisma schema, migrations, seed
packages/contracts  _planned_  shared schemas/types/error codes/socket events
packages/backend-core _planned_ shared domain services (api + worker)
packages/ui         _planned_  shared export components (only if reused)
infra               _planned_  docker-compose (postgres, redis)
```

## Roles & Principals

| Principal | Source | Notes |
|-----------|--------|-------|
| USER | `User.role = USER` (default for every new Telegram account) | Subscriber status is per-creator access, not a role |
| CREATOR | `User.role = CREATOR`, set only by admin approval | Same account; no customer mode; no switcher |
| Admin | `AdminAccount` (separate table) | Username/password + JWT; `/v1/admin` only |

Account status: `ACTIVE` / `BLOCKED` (separate from subscription expiry).

## Entities

| Entity | Status | Description |
|--------|--------|-------------|
| _(none yet)_ | | Target model in brief §13; add rows here as migrations land |

## API Endpoints

| Method | Route | Status | Description |
|--------|-------|--------|-------------|
| _(none yet)_ | | | |

## Socket Events

| Event | Status | Payload |
|-------|--------|---------|
| _(none yet)_ | | |

## Queues / Jobs

| Queue | Status | Purpose |
|-------|--------|---------|
| _(none yet)_ | | |

## Mini App Routes

| Route | Role | Screen (export ref) | Status |
|-------|------|---------------------|--------|
| _(none yet)_ | | | |

## Admin Routes

| Route | Screen (export ref) | Status |
|-------|---------------------|--------|
| _(none yet)_ | | |

## Design Handoff Inventory

Full board → route mapping lives in `design-integration.md` ("Miniapp Board Map", "Admin Route Map"). Track implementation progress here as screens are built.

| Area | Boards | Implemented |
|------|--------|-------------|
| Foundation (tokens, components) | `Main`, `CrMain`, `AdmMain` | no |
| Miniapp — auth/profile/request | `Auth*`, `Profile*`, `EditProfile`, `EditStates`, `CreatorRequest*`, `Request*` | no |
| Miniapp — customer | `Chats`, `Explore`, `Creator{Guest,Pending,Active,Expired}`, `Chat`, `ChatExpired`, `Subscriptions`, `Media*`, `States*` | no |
| Miniapp — creator | `CrInbox`, `CrChat*`, `CrCustomer`, `CrAttach`, `CrGallery*`, `CrViewer*`, `CrBroadcast*`, `CrSettings`, `CrEditProfile`, `CrPersona`, `CrPrice*`, `CrWelcome*`, `CrTimezone`, `CrStates*` | no |
| Admin | `AdmLogin*`, `AdmDash*`, `AdmCreators*`, `AdmCr*`, `AdmUsers*`, `AdmUser*`, `AdmLog*`, `AdmAi*`, `AdmSet*`, `AdmDlg*`, `AdmTableStates` | no |

Open design gaps (see `design-integration.md`): AI-assistance disclosure + Syarat Layanan/Kebijakan Privasi pages, admin queue for customer access requests, per-creator mute control, invalid-link / creator-opens-other-creator screens.

## Feature Backlog

| Feature | Phase | Stories | Status |
|---------|-------|---------|--------|
| workspace-foundation | A | US-001…002 | backlog |
| admin-auth | A | US-003 | backlog |
| telegram-auth | A | US-004…006 | backlog |
