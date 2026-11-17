# QA Report: TASK-185 — Live screens, reconnect catch-up and the offline panel

**Result:** PASS (US-031, 2026-11-17)

## Built
The open chat (customer and creator) refetches on `message.created` / `read.updated` for its conversation, coalesced; every reconnect refetches it and re-posts unsent bubbles with the same `client_message_id`; the chat list, inbox and nav badge refetch on `conversation.updated` (throttled 2 s with a trailing call) and on reconnect; the inbox offline panel now also follows the socket (dropped after having connected).

## Verified
miniapp 399 tests pass (12 new in `live-screens.spec.tsx`; all earlier expectations unchanged): a new bubble appears once even when the event repeats; another conversation's events do nothing; the Dibaca marker updates; reconnect after a gap of more than a page leaves no hole and the chat shows no banner; an unsent message is re-posted once with the same id and ends as one bubble; the list preview, unread and nav badge update live and after a reconnect; the inbox reorders live, a burst of five signals makes at most two refetches, the offline panel appears on a drop and on the browser `offline` event and not before the first connect; a creator chat adds a customer message live.

## Notes
- Real Telegram WebView behaviour of the WebSocket is **not verified** (needs a manual check; long-polling stays as the fallback). No proxy or deployment work was done.
- Deviation from the plan: the immediate disconnect on a block or role change uses PostgreSQL `NOTIFY` sent inside the account-security transaction (delivered only on commit) instead of an after-commit callback, because every real caller uses the in-transaction variants. The recheck interval is a constant (30 s); tests call `recheckAll()` directly.
