# QA Report: TASK-048 — Profile contracts, `telegram_avatar_url` migration, decisions log

**Result: PASS** (2026-11-16)

## Checked
- `profile.ts`: name trimmed, 1–40 code points, control characters rejected; bio trimmed, ≤160, newlines kept (CRLF normalized), blank/null/missing → `null`; unknown keys (`id`, `role`, `telegram_id`, `username`, `status`) stripped; `reset_avatar` boolean only. 9 new unit tests incl. 40/41, 160/161, emoji by code point.
- `UserProfileSchema` gained `bio` and `telegram_avatar_url`; login and `/me` map them; all fixtures updated.
- Migration `20261118010000_user_telegram_avatar` applied with `migrate deploy` on the local dev DB (additive; backfills from `avatar_url`). No length CHECKs on purpose: existing names may exceed 40 and the limits live in the shared schema.
- Login: a later login refreshes `telegram_avatar_url` and `telegram_username` only; name, bio and app photo are untouched (integration test). New names are cut to 40 code points so the edit form never opens with an over-limit name.
- Decisions recorded in `tech-stack.md`.

## Commands
`pnpm typecheck` ✔, `pnpm lint` ✔ (fixed `no-control-regex` with `\p{Cc}`), contracts 65 tests ✔, backend-core 153 tests ✔, db 62 tests ✔.

## Notes
- Seed fixtures have no photos, so no seed change was needed.
- Not run here: the full `pnpm test` (api/miniapp suites) — they run in the later tasks.
