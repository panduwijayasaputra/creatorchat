# QA Report: TASK-152 — Mini App chat screen (Chat, ChatExpired, loading state)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `ChatPage.spec.tsx` (13) passed; full miniapp suite 287 passed; ESLint and `tsc` clean.
- Playwright (`pnpm visual -g miniapp-chat`), viewed side by side:
  - `miniapp-chat` 22.7 % diff: header, day chips, bubble shapes, Mengirim… / Belum terkirim / Kirim Ulang and the composer match. Expected differences: the board's two media bubbles (Phase D), the "Dibaca" tick (US-030), the generic avatar illustration, and the subtitle sitting ~1 px lower.
  - `miniapp-chat-expired` 15.7 %: pill (`Akses berakhir 6 Nov 2026, 23.59 WIB`), panel and button match; differences: the media bubble and the tick.
  - `miniapp-chat-loading` 3.0 % vs the third frame of `StatesAccess`: skeletons and composer match; the board shows the creator name, which is unknown before the first answer (gap).
- Review: no "AI" / "Manual" / "Dibaca" text (asserted); buttons never wrap; status = icon + label; the renewal button posts the US-023 request once (double click tested) and opens the profile, which shows the result.
## Findings
- Fixed in review: a background refetch scrolled a reader who had scrolled up back to the bottom; it now follows only while the reader is near the bottom (I did not add a test for this).
- Placeholders, logged in `design-integration.md`: creator-blocked panel, the … button toast, error / not-found / empty, older-history failure, other-year day label, blank header name while loading.
- Not verified: behaviour inside real Telegram (safe area, keyboard, BackButton); the back arrow goes to `/chats` (placeholder until US-027).
