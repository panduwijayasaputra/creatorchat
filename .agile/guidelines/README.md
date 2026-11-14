# Development Guidelines

Technical guidelines every agent MUST follow in CreatorChat. Product rules live in the brief: `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md`. Guidelines implement the brief; the only overrides are the user decisions recorded in `design-integration.md` → "Resolved Conflicts".

## Files

### tech-stack.md
Agreed stack, monorepo layout, target scripts, decisions log (versions and TBD choices). **Read first.**

### backend.md
NestJS + Fastify API, BullMQ worker, Prisma/PostgreSQL, contracts, backend-core.

**Covers**: module layout, data-model rules, authorization hard rules (ownership + entitlement), Telegram/admin auth, chat/AI concurrency, outbox/queues, media, HTTP/realtime conventions, logging, testing.

**When to reference**: any `apps/api`, `apps/worker`, or `packages/{db,contracts,backend-core}` task.

### frontend.md
React + Vite Mini App and admin dashboard.

**Covers**: design-export fidelity (Rule 0), Telegram Mini App rules, role-based navigation, chat/media UI rules, admin table + confirmation rules, forbidden patterns, testing.

**When to reference**: any `apps/miniapp`, `apps/admin`, or `packages/ui` task.

### design-integration.md
How to use the Claude Design handoff (`designs/creator-chat-design-handoff/design/`): tokens, hard visual rules, shared components, miniapp board map, admin route map, seed data, and the **binding resolved conflicts** between design and brief (AI disclosure, no AI memory, display-only price, welcome message, no blurred gallery, timezone), plus known design gaps.

**When to reference**: any UI task, and any backend task touching AI, gallery access, creator settings, or welcome messages.

### codebase-map.md
What actually exists: entities, endpoints, socket events, queues, routes, design-export inventory, feature backlog. Read before planning or implementing; update after each story.

## How Agents Use These Guidelines

| Agent | Must |
|-------|------|
| `/po` | Read brief; reject superseded features (brief §20); tag stories with a phase (A–H) |
| `/tech-lead` | Read codebase-map + guidelines; plans cite brief sections and list files under `apps/*`/`packages/*` |
| `/dev` | Follow guidelines exactly; never redesign; never use real credentials/paid AI |
| `/qa` | Verify authorization hard rules, idempotency, design fidelity, brief rules; run checks |

## Quick Reference

### Backend task
```
Read: backend.md
Pattern: Nest module (thin controller) → service → backend-core → Prisma (tx)
Contracts: packages/contracts schemas (runtime validation + shared types)
Must: scope every ID by principal, check entitlement server-side, persist before emit
```

### Frontend task
```
Read: frontend.md + design-integration.md
Pattern: board PNG → exact values from board HTML → shared components + typed API hooks; no redesign
Verify: Playwright screenshot at board size vs PNG
Must: loading/empty/error states, safe area/BackButton (miniapp), server-side tables + confirm dialogs (admin)
```

### Full-stack slice
```
Read both. Build vertically: UI → contract → API → DB → test.
Contract change in packages/contracts first; both sides consume it.
```

## Updating Guidelines

1. Update the relevant .md file (and the decisions log in tech-stack.md for new choices).
2. Keep examples consistent with real code once it exists.
3. Update this README if adding a guideline file.

⚠️ **CRITICAL**: These guidelines are not optional. Code that violates the authorization hard rules or redesigns the export is a QA blocker.
