# QA Report: TASK-163 — ChatListService, conversation_id on profile and Langganan

**Result:** PASS (US-027, 2026-11-17)

## Built
`ChatListService.list` (one page query with a lateral last-message join and keyset cursor, one grouped unread count, one subscription lookup) and `unreadTotal`; strict cursor codec; `conversationId` on `CreatorAccessService.profile` and every Langganan card. Access uses the chat screen's `chatAccessState`.

## Verified
backend-core 521 tests pass (about 30 new): the two board rows; empty and message-less conversations; ordering with id tie-break; preview collapsed and cut to 120 characters; expired / revoked / blocked-creator access, and every row agrees with the chat history's access; two customers never see each other's rows; paging covers every row once, a message arriving between pages causes no duplicate or skip, equal times split by id, forged / malformed cursors refused, a cursor naming another customer's id returns only my rows; unread counts only creator messages after my cursor, other participant's cursor ignored, total includes expired and blocked-creator conversations and handles 120; statement count equal for 1 and 50 rows (3). One bug found and fixed by the tests: `'\s+'` inside a tagged SQL template is cooked to `'s+'`, which replaced every letter s in a preview; replaced by `[[:space:]]+`.

## Notes
- Opening a chat does not clear the badge: the read cursor writer is US-030. Realtime is US-031, so counts are as fresh as the last navigation.
- Placeholder copy (no board): Muat lagi and its failure text, "Belum ada pesan", the blocked-creator row chip.
- Real Telegram untested.
