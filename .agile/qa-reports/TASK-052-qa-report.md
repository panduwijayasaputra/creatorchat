# QA Report: TASK-052 — `/profile` screen (`Profile`)

**Result: PASS** (2026-11-16)

- `/profile` renders inside `CustomerShell` (bottom nav, Profil current); copy verbatim from `Profile.html`. Values (sizes, radii, spacing) copied from the HTML into `profile.module.css`; links styled as the design buttons, `white-space: nowrap`.
- Playwright (`pnpm visual -g miniapp-profile`, 390 px, 2x): sheet `visual/output/sheets/miniapp-profile.png` reviewed side by side with `Profile.png`; size matches (780x2600), diff 2.5% (informational). Remaining differences are about 1 CSS px text baseline shifts in the identity block; layout, icons, switches, cards and nav match.
- Notifikasi switches are disabled in the designed state (on / off), nothing persisted (Phase E). Kebijakan Privasi gives a placeholder toast (design gap, `profile-copy.ts`). **Hubungi Admin** opens the bot via `openTelegramLink` (Telegram WebApp, else new tab) only when `VITE_TELEGRAM_BOT_USERNAME` is set. **Ajukan Jadi Creator** → `/profile/creator-request` (`NotImplemented` until US-010).
- No `@` line when there is no Telegram username; CREATOR is redirected to `/inbox`.
- Tests: 8 new component tests; two stale router tests updated (profile is no longer a placeholder; "no role control" assertion made specific). Miniapp 107/107 ✔, lint ✔, typecheck ✔.

## Notes
- Placeholder copy (gap): "Kebijakan Privasi belum tersedia." Final wording needed from the product owner.
