# QA Report: TASK-175 — ConversationReadService in backend-core

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `conversation-read.service.int.spec.ts` (10, real PostgreSQL) with the chat and inbox suites: 49 passed.
- Covered: each participant moves only their own cursor; interleaved sends and reads keep the customer and creator unread counts right (including a new message after reading everything); monotonic (older value → `moved=false`, still the higher cursor); 10 parallel advances end at the maximum; clamp to the newest message and a no-op on an empty chat (no row, no event); one `read.updated` per real move with ids and a number only, nothing for a repeat; IDOR (other customer, other creator, swapped roles, unknown id → not_found, nothing stored); works after expiry and for a blocked creator; `peerReadSeq` follows only the creator's cursor; `unreadConversations` counts conversations.
## Notes
- The plan said `GREATEST` in the upsert. Because the conversation row is locked first and the new value is compared to the current one inside the same transaction, the cursor can only rise; a plain upsert after that check is equivalent and simpler.
