# QA Report: TASK-170 — API endpoints

**Result:** PASS (US-029, 2026-11-17)

## Built
`CreatorChatController`: `GET` / `POST /v1/creator/conversations/:id/messages` and `GET …/:id/customer`, `@Roles('CREATOR')`, `no-store`, 201 / 200 on send, 403 `CHAT_ACCESS_EXPIRED`, 409 `IDEMPOTENCY_CONFLICT`, one identical 404 for foreign, unknown and malformed ids.

## Verified
api 357 tests pass (8 new, real app): 401 without a token, USER 403 `FORBIDDEN_ROLE`, blocked creator 401 on all three routes; the three kinds of bad id return byte-identical bodies and store nothing; send 201 then 200 with one row, 409 for other text; expired access 403 with no message or outbox row but readable history; strict body and query; no customer id, Telegram id, creator id or username in the history JSON; the customer-side history shows the reply without `origin`; `roles-declared.spec.ts` green.

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
