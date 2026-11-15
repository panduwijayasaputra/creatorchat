# QA Report: TASK-020 — Admin auth contracts and error codes

**Result:** PASS

## Checked
- `packages/contracts/src/admin-auth.ts`: login request (trimmed username, untrimmed password, designed copy "Username wajib diisi." / "Password wajib diisi.", max lengths, unknown keys stripped), `AdminSessionResponseSchema` is strict (a hash or token field fails), lockout constants (5 attempts, 900 s), cookie names, CSRF header name, failure/lock details schemas.
- `errors.ts`: `INVALID_CREDENTIALS`, `LOGIN_LOCKED`, `CSRF_FAILED` added; `ErrorResponseSchema` accepts details for them.
- No Prisma/Nest imports in contracts; Zod 4 only.

## Results
- `pnpm --filter @creatorchat/contracts typecheck` and `test`: 25 tests pass (11 new).
- Prettier applied.

## Notes
- `ADMIN_LOGIN_MESSAGES` is shared so the UI and API show the same validation strings.
