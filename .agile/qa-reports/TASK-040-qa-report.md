# QA Report: TASK-040 — Dev tooling — `pnpm telegram:webhook`

**Result:** PASS

## Checked
- `packages/backend-core/scripts/webhook-tool.ts` + runner (placed next to `telegram:initdata`, a deliberate deviation from the plan's root `scripts/` folder). `webhook-tool.spec.ts` (9 tests against a fake Bot API server): dry run without `--yes` makes no request; `--yes` sends `setWebhook` (secret, `message` updates only) and `setChatMenuButton`; `--drop-pending` only when asked; `info` is read-only; refuses production, a missing/placeholder token, a short/missing/reused secret and non-https URLs; the token and secret never appear in output, Telegram error messages or network-failure messages. The Bot API root is a function parameter, not an env var.
- The command was NOT run against real Telegram (no real token here).

## Not verified here
- Real Telegram behaviour (see TASK-042).
