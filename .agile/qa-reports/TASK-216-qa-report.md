# QA Report: TASK-216 — Mini App customer media bubbles and viewer

**Result:** PASS (US-037, 2026-11-18)

## Built
Customer MediaBubble variant, ChatMediaViewer over nested route media/:attachmentId, shared ItemViewer (paramName, footer), thumbnail-expiry refetch, failed-send scroll.

## Verified
7 Mini App specs; Playwright entries miniapp-chat, miniapp-chat-expired, viewer photo/video; visual suite 128 passed.

## Notes
Not verified in a real Telegram WebView (video Range, HEVC).
