# QA Report: TASK-049 — `ProfileService.updateOwnProfile` in backend-core

**Result: PASS** (2026-11-16)

- Single transaction: `updateMany` limited to `status = ACTIVE` (count 0 → `ProfileAccountNotActiveError`), then, only for `reset_avatar`, one parameterized `$executeRaw` (`avatar_url = telegram_avatar_url`) while the row lock from the first update is held. Result mapped through `toUserProfile`; no Prisma model leaks.
- Only `display_name`, `bio` and (on request) `avatar_url` are written; role, status, telegram fields, `session_version` are never in `data`.
- 9 integration tests (real test DB): update + shape, clear bio and idempotent double save, reset only when asked, reset with no Telegram photo → null, untouched role/status/telegram fields, BLOCKED rejected with no write, unknown id rejected, only the caller's row changes, concurrent block never yields a write after the block.
- `pnpm typecheck` ✔, `pnpm lint` ✔, backend-core integration suite ✔.
