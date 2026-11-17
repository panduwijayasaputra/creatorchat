# QA Report: TASK-159 — Mini App inbox screen (CrInbox, CrStatesInbox)

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `InboxPage.spec.tsx` (8) passed; `router.spec.tsx` updated (`/inbox` is real, `/inbox/:id` placeholder). Covered: rows with initials, preview, times in the account zone, unread badge, one "Akses berakhir" chip; only the two chips, none of the Phase F text, no search box; Belum Dibaca refetches with `filter=unread` and shows the placeholder note; next page loads once on scroll; loading skeleton; empty copy + Salin Link Profil copies the `t.me` link; error + Coba Lagi; offline panel on the `offline` event and gone on `online`.
- Playwright vs `CrInbox` and the four `CrStatesInbox` frames, viewed side by side: layout, copy, avatars, badges, chip, skeleton rows, state icons and buttons match. Diffs: `miniapp-inbox` 13.5 %, loading 3.1 %, empty 2.5 %, error 2.4 %, offline 7.1 %. Expected differences: the board's search box, Manual / Perlu Perhatian chips, AI row chips and the nav badge "2" (all not built); the offline frame of the board shows no chips, so they are hidden while offline.
## Findings
- Fixed after the first screenshots: the empty and error blocks sat ~13 px high (padding corrected); chips hidden while offline to match the frame.
- The inbox spec uses a mock `IntersectionObserver`; real-browser scrolling was not exercised.
