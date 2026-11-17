# QA Report: TASK-166 — Bottom-nav unread badge and the links into the chat

**Result:** PASS (US-027, 2026-11-17)

## Built
`UnreadProvider` (fetch on mount, route change throttled to 5 s, tab visible; keeps the last value; never fetches for a CREATOR) feeding `CustomerShell` / `CustomerFrame`; "Buka Chat" (profile, approved card, Langganan) and "Lihat Riwayat Chat" are links to `/chats/:conversationId`, falling back to the toast without a conversation.

## Verified
miniapp 341 tests pass (new: badge shows server total, 99+, none at 0 or before the first answer, prop override, failed refresh keeps the value, visible vs hidden, throttle, creator never fetches; link tests on profile and Langganan with and without a conversation). Full Playwright run: every item passes after adding `conversation_id` to the profile / Langganan visual mocks (the seven that timed out before).

## Notes
- Opening a chat does not clear the badge: the read cursor writer is US-030. Realtime is US-031, so counts are as fresh as the last navigation.
- Placeholder copy (no board): Muat lagi and its failure text, "Belum ada pesan", the blocked-creator row chip.
- Real Telegram untested.
