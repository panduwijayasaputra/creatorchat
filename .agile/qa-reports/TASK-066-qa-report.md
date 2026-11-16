# QA Report: TASK-066 — `Profile` blocked variant (`ProfileBlocked`) and visual checks

**Result: PASS** (2026-11-16)

- `ProfilePage` reads `getCreatorRequestState()`. When the server reports a block it shows "Ingin menjadi creator?", the reason text, "Langganan aktif: <creator>, hingga <date>" with the green check, and an inert **Ajukan Jadi Creator** button (disabled, pink, `not-allowed`). The date goes through `formatDateTime` with the account's timezone (27 Nov 2026 in Jakarta; a Sydney account at 20:00 UTC reads 28 Nov). While the state loads, or if it cannot load, the normal invitation stays (the submit call re-checks, so a missed block is refused there). The pending and rejected variants are US-011.
- Tests: 4 new Profile tests (blocked, timezone date, no block, load failure) and the existing 11 pass; miniapp 180 pass.
- Visual: `miniapp-profile-blocked` (780x2600, diff 3.6%) reviewed side by side: card, check line, button, notifications and help sections match. The avatar differs only because the harness user has a photo. All 44 visual items pass.
- Workspace: `pnpm typecheck`, `pnpm lint`, `pnpm test` (contracts 109, db 70, backend-core 188, api 165, miniapp 180, ui 169) and `pnpm build` pass; preview code is not in `dist`.

## Not verified here
- Real Telegram; the seeded Raka Putra account reads "Salsa", not "Salsa Maheswari" (fixture data).
