# QA Report: TASK-146 — Mini App Langganan page

**Result:** PASS (US-025, 2026-11-17)

## Built
`/subscriptions` (`SubscriptionsPage`, `useSubscriptions`, copy, CSS): cards per the board, Buka Chat placeholder toast, Profil link, Minta Perpanjangan Akses through the US-023 request then refetch, unavailable creators without actions, StatesChats-layout loading / empty / error, footer with the account zone, router entry replacing the placeholder.

## Verified
miniapp tests pass (new page spec, 17 cases): three cards in order with chips, date lines, buttons and footer; Sydney zone dates and footer; Buka Chat toast with no API call; unavailable creator has no button, no link and a note; hostile name as text; no price words; one request on a double tap then Menunggu; disabled while sending; failure message and retry; 409 / 404 refetch; failed refetch keeps the old list; empty state links to /explore; error retry; CREATOR redirected to /inbox. Playwright at 390 px: `Subscriptions` 3.8 % diff (initials instead of the board's illustrated avatars, as on Explore; the Chat badge "2" belongs to the chat stories).

## Notes
- Placeholder copy (no board): empty / error / loading text, the blocked-creator note, the sending label and failure message of the extend button.
- Real Telegram untested. `pnpm test` in `packages/db` currently fails one scope test because another session added a `messages` table (migration `20261126010000_messages`); that is not part of this story.
