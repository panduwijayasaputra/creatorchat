# QA Report: TASK-057 — `/settings` screen (`CrSettings`)

**Result: PASS** (2026-11-16)

- Inside `CreatorShell` (role-gated; a USER is redirected to `/chats` and never calls the creator API, asserted). Loading, failure with a "Coba Lagi" retry, and ready states.
- Board copy and values from `CrSettings.html`: header with name, `@username · dari Telegram` and chip "Creator · disetujui admin" (icon + label), "Preview profil", Edit Profil, "Link bot untuk bio Instagram", "Salin Link Profil", the four rows, "Akun dan bantuan".
- Deliberate deviations (design gaps, no fake data): no "Kuliner & slow living · Bandung" line; no "Tersimpan" / "Aktif" chips; no price or timezone values. Later rows open the "belum dibangun" placeholder (`/settings/persona|welcome|price|timezone`). "Bantuan" shows only with `VITE_TELEGRAM_BOT_USERNAME`.
- The bio link comes from the server; null shows "Link bot belum diatur. Hubungi admin." and a disabled button. Copy uses `navigator.clipboard`, then an `execCommand` fallback, and a failure shows a toast instead of staying silent. Toast wording is placeholder copy (`creator-copy.ts`).
- 9 component tests plus a router test. `Avatar` gained optional `height` and `radius` for the 72x96 preview photo; `CopyIcon` and `GlobeIcon` added from the board SVG.
