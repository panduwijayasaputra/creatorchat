# QA Report: TASK-001 — Workspace scaffold, tooling and pinned versions

**Result:** PASS
**Date:** 2026-11-15

## Checked
- Fresh build from a clean state (generated client and dist removed): `pnpm build`, `pnpm typecheck`, `pnpm lint` all pass. `pnpm-lock.yaml` committed-ready; versions pinned exactly (`save-exact`).
- Versions verified against npm registry + peerDependencies/engines (typescript-eslint caps TypeScript at <6.1, so TS 6.0.3 not 7; Prisma 7.10.1 because 8 is rc; Nest 12 is ESM-only so the workspace is ESM). Recorded in `tech-stack.md` decisions log + Pinned Versions table.
- Leftover untracked scaffold folders were listed first (0 source files) and removed; nothing of the user's was deleted.
- Native build scripts (argon2, prisma, swc, esbuild) explicitly approved in `pnpm-workspace.yaml` (pnpm 12 `allowBuilds`).

## Notes
- `build:packages` runs `prisma generate` via the db package build, so a fresh clone builds without a manual step (generated client is git-ignored).
- `pnpm test` builds packages first; DB-backed projects need PostgreSQL (see TASK-006 report).
