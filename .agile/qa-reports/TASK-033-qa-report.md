# QA Report: TASK-033 — Dev tooling: `pnpm telegram:initdata`

**Result:** PASS

## Checked
- `packages/backend-core/scripts/initdata-tool.ts` (+ thin `telegram-initdata.ts`): prints initData signed with `TELEGRAM_BOT_TOKEN` from `.env` and a ready dev URL (`/?tgdev=<urlencoded>`). Options `--id`, `--name`, `--last-name`, `--username`, `--photo`, `--age-seconds`. Refuses `NODE_ENV=production`, a missing or placeholder token, a bad id and a negative age. The token is never printed (asserted).
- `test/initdata-tool.spec.ts` (4 tests): output validates with the same token and maps the user; fails with another token; `--age-seconds 90000` becomes `expired`; refusal cases.
- Ran the real command: it prints a signed initData and URL; `--id abc` prints the error and exits non-zero.
- `tsx` 4.23.15 (same pin as `packages/db`) added to backend-core devDependencies; root script `pnpm telegram:initdata`; backend-core `tsconfig.json` now includes `scripts`.
- Docs: README ("Mini App login (Telegram)" with steps, command table row), CONFIGURATION.md (local alternative to real Telegram, `USER_SESSION_SECRET` rules, CORS note), `.env.example` comment.
- Local `.env` (git-ignored): `USER_SESSION_SECRET` generated, `TELEGRAM_BOT_TOKEN` set to an obviously fake local value (`…local-dev-token-not-a-real-bot`), `TELEGRAM_BOT_USERNAME` set to a sample; no value was printed except the fake-token hint in the tool's own error message text.

## Results
- backend-core 104 tests pass; typecheck and lint pass.
