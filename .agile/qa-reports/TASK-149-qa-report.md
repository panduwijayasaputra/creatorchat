# QA Report: TASK-149 — ChatService in backend-core (history + send)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `chat-access.spec.ts` (5) and `chat.service.int.spec.ts` (20, real PostgreSQL): 25 passed.
- Covered: seq 1, 2 and one outbox event of ids only (no body); replay returns the same row; same id with other text → conflict; 10 parallel sends with one id → one row; 10 parallel with different ids → seq 1..10 without gaps; expired / revoked / no subscription → refused, nothing stored, counter unchanged; creator or creator account blocked; blocked customer; replay after expiry still returns the stored message; empty / 2001 / 2000; IDOR (other customer, unknown id, the creator themself); history paging, exact-fit last page, stability while messages arrive, sender mapping, no ids in the answer, readable when expired or creator blocked.
## Review notes
- Authorization: every read and the send are scoped by `customer_id`; the conversation row is locked (`FOR UPDATE OF c`) before the replay check and the entitlement check, so retries and concurrent sends serialise.
- Deviation from the plan: outcomes are returned as a union (`kind`), like `AccessRequestService`, instead of thrown error classes.
- `SendOutcome` clashed with the notifications module export; named `SendMessageOutcome`.
