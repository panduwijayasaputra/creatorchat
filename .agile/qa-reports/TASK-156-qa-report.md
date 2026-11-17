# QA Report: TASK-156 — CreatorInboxService in backend-core

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `creator-inbox.service.int.spec.ts` (18, real PostgreSQL): order and move-to-top; chats without messages absent; IDOR (other creator, a customer id); no Telegram id / username / customer id in the output; preview cut at 120 and whitespace collapsed (own message can be the last); unread counts, `filter=unread`, total independent of the filter, a cursor at the last message → 0; `access_active` for active / expired / revoked / none / blocked customer / blocked creator; pages of 2 over 5, exact fit, a chat moving to the top between pages, ties on the same time; bad and tampered cursors.
## Findings
- Fixed during dev: the keyset predicate compared a text id with a uuid (SQL error); the id is now compared as text (same order for lowercase hex).
- One of my own test expectations was wrong (the remaining rows after the cursor are C3 and C2); the code was right.
