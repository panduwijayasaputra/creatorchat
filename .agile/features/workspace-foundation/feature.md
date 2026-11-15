# Feature: workspace-foundation

**Phase:** A — Foundation
**Roles:** System (developer workflow), indirectly all roles
**Brief refs:** §12, §13, §14, §16 (A), §18
**Design refs:** `Main`, `CrMain`, `AdmMain` (foundation boards); `design-integration.md` → Foundation

## Overview

Sets up the base everything else builds on:

1. A working pnpm monorepo (`apps/api`, `apps/worker`, `apps/miniapp`, `apps/admin`, `packages/db|contracts|backend-core|ui`), local PostgreSQL + Redis (native, no Docker), env examples, a README with concrete setup steps, and the baseline database schema for identity, sessions and audit.
2. The design system foundation from the Claude Design handoff (tokens, Inter, icons, shared components, the admin and Mini App shells), verified against the foundation boards.

No product screens beyond the shells. Versions are pinned after checking official docs (decisions log in `tech-stack.md`).

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-001 | Workspace, local infrastructure, and database baseline | high |
| US-002 | Design system foundation and app shells | high |
