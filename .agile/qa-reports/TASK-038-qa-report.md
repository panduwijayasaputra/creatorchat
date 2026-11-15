# QA Report: TASK-038 — API — Telegram webhook (grammY)

**Result:** PASS

## Checked
- `apps/api/test/telegram-webhook.spec.ts` (14 tests, Fastify inject, a fake Bot API HTTP server): reply is the webhook response with the `web_app` button; plain URL for junk payloads; 401 for missing/wrong/longer/shorter secret and a query-string secret; the secret is checked before the body is parsed (malformed JSON with a wrong secret gives 401, with the right secret gives 400 without echoing the body); unsupported updates (group `/start`, plain text, callback query, edited message, channel post, empty update) give 200 and no reply; 503 when the secret, token or Mini App URL is missing while `/v1/health` still answers; no outbound Bot API request at all; the bot token, the secret, the update text and the sender name never appear in logs; `no-store`.
- Found and fixed during development: Nest answered 201 (added `@HttpCode(200)`) and grammY 1.46 does not use webhook reply unless `canUseWebhookReply` is set (enabled for `sendMessage` only).
- `grammy@1.46.0` pinned (npm registry checked). Test seam: `TEST_BOT_API_ROOT` is honoured only when `NODE_ENV=test`.

## Not verified here
- Real Telegram behaviour (see TASK-042).
