# QA Report: TASK-058 — `/settings/profile` (`CrEditProfile` + `EditStates`) and visual check

**Result: PASS** (2026-11-16)

- `/settings/profile` is under `RequireRole CREATOR`, outside the shell, and renders the shared `ProfileForm` with the back arrow to `/settings`. Same states and rules as US-007, verified for a CREATOR: values shown, save through the creator endpoint, banner keeps the typed input, empty name blocked, USER redirected. 6 component tests.
- Visual (`pnpm visual`): `miniapp-creator-settings` (780x3400, diff 11.8%) and `miniapp-creator-edit-profile` (780x1920, diff 5.1%) reviewed side by side. Remaining differences: the category/city line, the two status chips and the row values (intentionally not built), the Inbox unread badge (shell state, not passed in the harness) and the avatar illustration (shared placeholder). Spacing, fonts, copy, icons and buttons match; text is about 1 px off in places, as in US-007.
- Harness fix: the existing `miniapp-creator-link-tidak-tersedia` item raced the loading screen (a different `<main>` that is replaced) and failed with a zero-size clip. It now waits for the resolved heading. It passes on the baseline commit and passes again.
- Workspace: `pnpm typecheck`, `pnpm lint`, `pnpm test` (contracts 67, db 62, backend-core 169, api 131, miniapp 138, ui 169) and `pnpm build` all pass; preview code is not in `dist`.

## Not verified here

- Real Telegram (WebApp `openTelegramLink`, clipboard permission inside the Telegram WebView, virtual keyboard with the sticky save bar, safe area); only jsdom and the stubbed Playwright harness.
