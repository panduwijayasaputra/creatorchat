# QA Report: TASK-027 — Contracts: Telegram login, `/me`, error codes

**Result:** PASS

## Checked
- `packages/contracts/src/user-auth.ts`: strict request (`init_data` only, 1–4096 chars), strict profile (`telegram_id` digit string, `status: ACTIVE`), strict login response, `landingPathForRole` (USER → `/chats`, CREATOR → `/inbox`). Three new error codes in the catalogue.
- Tests: extra keys (`role`, `session_version`) rejected, numeric `telegram_id` rejected, token type pinned. Contracts suite 30/30; typecheck, lint, build pass.
