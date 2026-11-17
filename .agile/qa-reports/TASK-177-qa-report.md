# QA Report: TASK-177 — Mini App: mark as read, Dibaca, creator badge

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- Mini App suite 377 passed (36 files); ESLint and `tsc` clean.
- New: `useChat.read.spec.tsx` (6), `ChatPage.read.spec.tsx` (6), `useCreatorChat.read.spec.tsx` (3), three `UnreadProvider` tests (creator badge, customer never asks for the creator count, no badge at 0).
- Covered: posts the newest other-side seq once on open; nothing when only my messages are on screen; hidden tab posts nothing and a visible event does; never twice for the same value and one request in flight with a newer value sent after the answer; a failed post is silent and retried; `peerReadSeq` never goes down on a stale refetch; "Dibaca" under only my latest read message (not creator's, not unsent, not at 0), same in the expired state; the creator side posts to the creator endpoint only.
## Notes
- US-029 was already built when this story started, so the creator conversation is wired here (`useMarkRead`, shared by both sides) instead of leaving it to US-029; the logic was extracted from `useChat`.
- Existing tests updated: the router test now expects the creator badge label "n percakapan belum dibaca"; the `UnreadProvider` "creator never fetches" test became "creator fetches the conversation count".
