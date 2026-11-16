# QA Report: TASK-053 — `/profile/edit` screen with `EditStates` and visual check

**Result: PASS** (2026-11-16)

- `/profile/edit` is under `RequireRole USER`, outside the shell (own header with back link, scrolling body, sticky save bar; no bottom nav). Fields, helper texts, counter, read-only username with lock and the info note are verbatim from `EditProfile.html`; values copied into `edit-profile.module.css`.
- States (one route): **Menyimpan** (button "Menyimpan…" disabled, `aria-busy`, form dimmed and inert, a double click sends one request); **Validasi** (shared contract schema on the client: "Nama tampil wajib diisi.", 40 / 160 limits by code point, whitespace-only = empty, first invalid field focused, errors clear live after the first attempt); **Berhasil** (toast "Perubahan disimpan", saved values kept in the form and the in-memory profile); **Gagal** (banner "Perubahan belum tersimpan" + "Koneksi terputus…", typed input kept, retry works; a server error uses placeholder copy, see gaps). A lost session is left to the auth layer.
- **Pakai Foto Telegram** only previews; `reset_avatar: true` is sent with the save and only after it was clicked. **Ganti Foto** makes no request (asserted) and shows a placeholder notice.
- Fixed during QA from the screenshots: the field `<label>` was inline (bottom margin ignored, inputs about 2 px too high) → `display: block`; and "Pakai Foto Telegram" had been made disabled when nothing differs, which the design does not show → always enabled.
- Visual (`pnpm visual -g miniapp-edit`): sheets for `EditProfile` (780x1920, diff 3.3%) and the four `EditStates` cards (390x960, 6.6–13.5%) reviewed side by side. Remaining differences: the board's rounded phone frame (decoration), the rose focus ring on the invalid field after a failed save (kept for accessibility), and the save button's hover colour from the pointer left over it. Layout, copy, icons, banner, spinner and toast match.
- Tests: 14 component tests. Whole workspace: `pnpm typecheck` ✔, `pnpm lint` ✔, `pnpm test` ✔ (contracts 65, db 62, backend-core 167, api 120, miniapp 121, ui 162, worker/other ✔), `pnpm build` ✔ (preview code not in `dist`).

## Not verified here
- Real Telegram (WebApp `openTelegramLink`, virtual keyboard with the sticky save bar, safe area) was not run; only the stubbed Playwright harness and jsdom.
