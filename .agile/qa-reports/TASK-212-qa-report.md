# QA Report: TASK-212 — Media bubbles in the creator thread and media previews in lists

**Result:** PASS (US-036, 2026-11-18)

## Built
`MediaBubble` for MEDIA messages on both sides (thumbnail or poster with duration, message, time, tags), optimistic media bubble, thumbnail-link refresh once, "Foto" / "Video" in the chat list and inbox.

## Verified
Tests: photo / video bubbles with and without text, button only when openable, failing thumbnail reported, Manual tag only when asked, text bubbles unchanged; list and inbox show the words for media-only messages and keep text previews. All 452 Mini App tests and lint pass. The realtime spec now waits for its socket (it assumed it existed at once and failed under load).

## Notes
The bubble is not tappable yet: the viewer for received files is US-037.
