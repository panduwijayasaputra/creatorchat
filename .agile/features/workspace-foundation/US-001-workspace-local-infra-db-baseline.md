# US-001: Workspace, local infrastructure, and database baseline

**Status:** backlog
**Priority:** high
**Feature:** workspace-foundation
**Phase:** A
**Roles:** System
**Brief refs:** §12, §13, §14, §16 (step 4–5, 8), §18
**Design refs:** none (non-visual); seed data from `DESIGN.md` → "Data sampel"

## Description

As the project owner (a developer new to Docker), I want one repository where API, worker, Mini App, and admin start locally with a few documented commands on a real PostgreSQL and Redis, so that every later feature can be built and tested on the same foundation.

## Acceptance Criteria

- [ ] A pnpm workspace contains `apps/api` (NestJS + Fastify), `apps/worker`, `apps/miniapp` and `apps/admin` (React + Vite), and `packages/db`, `packages/contracts`, `packages/backend-core`, `packages/ui`. Dependency versions are pinned, `pnpm-lock.yaml` is committed, and the versions are recorded in the `tech-stack.md` decisions log.
- [ ] `infra/docker-compose.yml` runs only PostgreSQL and Redis, with named volumes and healthchecks. Following the README from a clean clone (`pnpm install`, `docker compose … up -d postgres redis`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`) starts all four apps. The API answers a health endpoint that reports DB and Redis reachability without exposing secrets. The README says to stop with `stop` and warns against `down -v`.
- [ ] Root scripts `typecheck`, `lint`, `test`, `build` exist and pass on the scaffold. Integration tests run against a separate test database (`DATABASE_URL_TEST`) and never touch dev data.
- [ ] The first Prisma migration creates the identity baseline: `User` (`telegram_id` BigInt UNIQUE, role USER/CREATOR, status ACTIVE/BLOCKED, profile fields, display timezone, `session_version`), `AdminAccount`, `Session` (belongs to exactly one user or admin, hashed refresh token, expiry/revoke), and append-only `AuditLog`. UUID keys and `timestamptz` throughout. Tables for later phases are not created yet.
- [ ] `.env.example` files (root server vars; `apps/miniapp` and `apps/admin` with `VITE_*` public values only) document every variable with placeholders, as in `CONFIGURATION.md`. The apps start in dev **without** real Telegram/R2/AI credentials and report which integrations are unconfigured.
- [ ] API errors use `{ code, message, request_id }`, every request gets a request ID that appears in logs, and logs never contain secrets, raw initData, or message content.
