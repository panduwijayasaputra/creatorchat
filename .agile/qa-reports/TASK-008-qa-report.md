# QA Report: TASK-008 — Seed fixtures

**Result:** PASS
**Date:** 2026-11-15

## Checked
- 7 integration tests (idempotent re-run, Argon2id hash verifiable and never plaintext, generated 24-char password returned once, username normalization, fixture roles/status/reserved IDs, existing users untouched) + 3 CLI guard tests (production, *_test DB, missing URL).
- Ran pnpm db:seed twice on the dev DB: the first run created 6 users + the admin and printed the password once; the second run reported "already exists; password unchanged".
