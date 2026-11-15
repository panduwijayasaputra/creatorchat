# QA Report: TASK-002 — Local infrastructure and env examples

**Result:** PASS (scope changed 2026-11-15)
**Date:** 2026-11-15

## Scope change
The user decided not to use Docker. The Compose file, `infra/` folder, Compose structure test and the `yaml` dev dependency were removed. `scripts/setup-postgres.sql` (idempotent role + dev/test databases) replaces them, and README/CONFIGURATION/CLAUDE/AGENTS/guidelines were updated.

## Checked
- `.env.example` files: every root key is documented in CONFIGURATION.md; client files contain only VITE_* names with no secret-like words; secrets are placeholders; no inline comments (safe for Node --env-file). Covered by `packages/backend-core/test/env-examples.spec.ts`.

## Not verified
- `scripts/setup-postgres.sql` has not been executed (needs the postgres superuser password).
