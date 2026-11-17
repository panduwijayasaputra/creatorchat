# QA Report: TASK-145 — API endpoint and Mini App client

**Result:** PASS (US-025, 2026-11-17)

## Built
`GET /v1/subscriptions` (`SubscriptionsController`, `@Roles('USER')`, `no-store`), `listSubscriptions` in the Mini App client and the fake API (default: the three board cards).

## Verified
apps/api 7 new integration cases plus `roles-declared`: exact contract and order; no ids / status / media / reason words in the body; revoked ended, blocked creator unavailable and its profile 404; each state equals the profile answer; an access that ended a second ago is EXPIRED; two sessions never see each other's relations; query string ignored; CREATOR 403 `FORBIDDEN_ROLE`, no token and blocked account 401; no row counts change. Client: GET with Bearer and no body, extra field refused, 403 kept as ApiError. An admin token against this route was not tested separately (the user guard's audience rule is covered in earlier stories).

## Notes
- Placeholder copy (no board): empty / error / loading text, the blocked-creator note, the sending label and failure message of the extend button.
- Real Telegram untested. `pnpm test` in `packages/db` currently fails one scope test because another session added a `messages` table (migration `20261126010000_messages`); that is not part of this story.
