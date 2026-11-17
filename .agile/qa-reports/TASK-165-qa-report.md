# QA Report: TASK-165 — Mini App chat list (Chats, StatesChats)

**Result:** PASS (US-027, 2026-11-17)

## Built
`/chats` (`ChatListPage`, `useChatList`, copy, CSS) replaces the placeholder: rows per the board, time `09.14` / `6 Nov` in the account zone, badge, ended and blocked-creator chips, discovery card, Muat lagi by cursor, StatesChats loading / empty / error.

## Verified
miniapp tests pass (new page spec, 16 cases): board rows and links, today vs older in two zones, blocked-creator chip and a conversation without messages, 99+, hostile text, no AI / manual / price words, card and rows navigate, the three states with retry, Muat lagi appends without duplicates / keeps rows on failure / sends once on a double tap, CREATOR redirected. Playwright: `Chats` 2.2 %, loading 2.8 %, empty 2.2 %, error 2.2 % (after centring the panel as the board does).

## Notes
- Opening a chat does not clear the badge: the read cursor writer is US-030. Realtime is US-031, so counts are as fresh as the last navigation.
- Placeholder copy (no board): Muat lagi and its failure text, "Belum ada pesan", the blocked-creator row chip.
- Real Telegram untested.
