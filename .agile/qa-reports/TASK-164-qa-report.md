# QA Report: TASK-164 — API endpoints and Mini App client

**Result:** PASS (US-027, 2026-11-17)

## Built
`GET /v1/chats` and `GET /v1/chats/unread` (`ChatListController`, `@Roles('USER')`, `no-store`), `conversation_id` on by-code and `/subscriptions`, `listChats` / `getChatUnread` in the Mini App client and fake.

## Verified
apps/api 337 tests pass (9 new): exact contracts, CREATOR 403 and no token / blocked customer 401 on both routes, paging over HTTP, 400 for bad limit / cursor / extra or repeated keys, IDOR with two sessions (rows, counts, ids, forged cursor), no creator id / status / body / message id in any response, no row counts change, `/chats/unread` is not captured by the conversation routes, `conversation_id` equals the list id and is own-only on profile and Langganan. Miniapp client: URLs and cursor encoding, extra field refused, 403 kept, unread validation.

## Notes
- Opening a chat does not clear the badge: the read cursor writer is US-030. Realtime is US-031, so counts are as fresh as the last navigation.
- Placeholder copy (no board): Muat lagi and its failure text, "Belum ada pesan", the blocked-creator row chip.
- Real Telegram untested.
