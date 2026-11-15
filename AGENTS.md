# CreatorChat (working name — final product name not decided)

Telegram Mini App for private chat between subscribers and creators (real people or AI characters), with optional AI replies in the creator's persona, subscriber-only gallery, chat/broadcast media, Telegram bot entry/notifications, and a separate web admin dashboard. **No payments in MVP** — access is granted by admins.

## Source of Truth

Priority when sources conflict:
1. The user's latest instruction.
2. User decisions recorded in `.agile/guidelines/design-integration.md` → "Resolved Conflicts" (2026-11-14).
3. Product rules in `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` (the **brief**).
4. The Claude Design handoff in `designs/creator-chat-design-handoff/design/` — visual source of truth (PNG for look, HTML for exact values, `DESIGN.md`, `INDEX.md`). Read-only.
5. Older docs/briefs (obsolete where they conflict; see brief §20).

Never build superseded or overruled features: payments/checkout/coins/tips/payout/revenue, multi-role or role switcher, onboarding carousel, blurred or locked gallery tiles for non-subscribers, AI memory or conversation summaries, automatic gallery insertion for chat or broadcast uploads, media library/drafts/archive, media scheduling, broadcast segmentation.

In scope from the design: welcome message to new subscribers, creator subscription price (display/settings only), per-account display timezone, admin persona edit with reason.

## Tech Stack

- **Language:** TypeScript end-to-end, pnpm workspaces
- **API:** NestJS + Fastify, REST `/v1` (+ `/v1/admin`), Socket.IO realtime
- **Worker:** separate Node process, BullMQ + Redis (AI, media processing, broadcast, notifications, access reminders)
- **Data:** PostgreSQL + Prisma; Cloudflare R2 (private bucket) for media
- **Bot:** grammY (webhook)
- **Mini App:** React + Vite (Telegram WebApp)
- **Admin:** React + Vite (separate app)
- **Local infra:** native PostgreSQL + Redis on the dev machine (no Docker); see README
- **Full details:** `.agile/guidelines/tech-stack.md`, `.agile/guidelines/backend.md`, `.agile/guidelines/frontend.md`

## Delivery Phases (brief §16)

A Foundation → B Profiles & creator applications → C Access & manual chat → D Media → E Broadcast & notifications → F AI → G Admin completion → H Pilot hardening.
Stories carry a `phase` field; plan/implement in phase order unless the user says otherwise.

## Pipeline

```
/po "feature"  →  /tech-lead  →  /dev-team (autonomous)  →  /status
 (WHAT)            (HOW)          (DO)                       (MONITOR)
```

Standalone commands (also used by /dev-team internally):
- `/dev` — implement a single task
- `/qa` — review and test a single task

### Story Statuses

```
backlog → planned → in_progress → developed → tested → ready_for_uat → done
```

### Task Statuses

```
pending → in_progress → developed → qa_failed? → tested → done
```

## Config

- `MAX_DEV_RETRIES: 1` — times dev retries after QA failure before escalating to user

## Rules

- Always read the brief + relevant guidelines (`.agile/guidelines/`) before generating or reviewing code
- Follow guideline patterns exactly — no improvisation on architecture or conventions
- Backend code (api, worker, packages/db, packages/backend-core, packages/contracts): `.agile/guidelines/backend.md`
- Frontend code (miniapp, admin, packages/ui): `.agile/guidelines/frontend.md`
- UI code: also follow `.agile/guidelines/design-integration.md`
- **Do not redesign.** UI follows the design handoff 1:1 (PNG first, exact values from HTML, Indonesian copy verbatim, buttons never wrap, status = icon + label). Verify with a Playwright screenshot at board size. If a needed screen isn't designed, report the gap instead of inventing a final screen.
- Customers never see AI labels in chat; AI context is persona + recent history of that conversation only.
- Work local/development only. No deployment, no real credentials, no paid AI calls in tests, no real broadcasts, no writes/deletes on production R2.
- Never run `prisma migrate reset`, `DROP DATABASE`, or other destructive DB commands on a database you didn't create for the task.
- Pin dependency versions after checking official docs; commit the lockfile. Don't install `latest` blindly.
- Report outcomes honestly: do not call mocks "integrations" or a passing build "production-ready".

## Data Files

| File | Purpose |
|------|---------|
| `.agile/.doc/` | Product brief and source documents |
| `designs/creator-chat-design-handoff/design/` | Claude Design handoff (read-only) |
| `.agile/backlog-index.json` | Lightweight story index (IDs, phase, status, file paths) |
| `.agile/sprint.json` | Currently in-progress tasks |
| `.agile/completed.json` | Finished work archive |
| `.agile/features/[name]/` | Story markdown files |
| `.agile/plans/` | Technical implementation plans |
| `.agile/qa-reports/` | QA reports (code review + test results) |
| `.agile/guidelines/codebase-map.md` | What actually exists in the code (keep in sync) |
