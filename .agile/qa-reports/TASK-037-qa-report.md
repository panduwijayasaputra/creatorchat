# QA Report: TASK-037 — backend-core — start payload, bot reply builder, `CreatorLinkService`

**Result:** PASS

## Checked
- `generatePublicCode` (unbiased byte mask; 10 000 unique codes, full alphabet), pure `buildStartReply` (origin can never change; injection payloads such as `c_../../x`, `//evil.com`, `c_a?b` give the bare origin; no Mini App URL gives `null`), `CreatorLinkService.resolve` (caller role read from the live row; uniform `not_found`; writes nothing).
- `isTelegramWebhookConfigured` + `telegramWebhook` in the integration status (secret >= 32 chars and different from the token). Two existing tests that pin the status shape were updated.
- Bot copy is placeholder Indonesian text in `bot-copy.ts` (design gap, reported).

## Not verified here
- Real Telegram behaviour (see TASK-042).
