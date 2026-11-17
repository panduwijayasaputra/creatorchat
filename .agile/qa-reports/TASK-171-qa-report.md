# QA Report: TASK-171 — Mini App data layer and shared chat pieces

**Result:** PASS (US-029, 2026-11-17)

## Built
`getCreatorChatHistory`, `sendCreatorChatMessage`, `getCreatorCustomer` and their fakes; `useChat` became `useThread` over a small adapter (the customer wrapper keeps its signature); `ChatThread.tsx` holds the bubble, unsent bubble, composer, skeleton and the scrolling `ThreadBody`, now used by both chat screens; `useCreatorChat`.

## Verified
miniapp tests pass: the 53 existing customer chat tests pass unchanged; 5 new hook tests (paging, 404 / error, send once, Kirim Ulang with the same id, a 403 flips the access to EXPIRED and drops the bubble). Note: another session edited the shared fake API and `Shells.tsx` during the work (US-030).

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
