# QA Report: TASK-032 — Mini App login screens (AuthLogin, AuthOutside, AuthStates) and visual check

**Result:** PASS

## Checked
- `apps/miniapp/src/auth/screens/`: `LoginScreen` ("Lanjutkan dengan Telegram", helper copy, Syarat Layanan / Kebijakan Privasi text), `OutsideScreen` ("Buka di Telegram" link to `https://t.me/<VITE_TELEGRAM_BOT_USERNAME>`, board copy), `ConnectingScreen` ("Menghubungkan ke Telegram…", `role="status"`, `aria-live="polite"`, spinner that respects reduced motion), `ErrorScreen` ("Belum bisa masuk" and "Sesi Telegram berakhir", both with "Coba Lagi"), `AuthGate` picking the screen from the auth state. Copy is verbatim from the boards; the 52 px primary button uses the shared `Button` (`size="lg"`), never wraps; no AI wording; no password/email field.
- The demo strip ("DEMO · bukan fitur produk", "Link creator", "Akun creator") is **not built** (asserted by a test).
- Two icons added to `packages/ui` from the boards: `ArrowUpRightIcon`, `WifiIcon`.
- `pnpm visual`: 27/27. The five new sheets were viewed: AuthLogin (780×1688), AuthOutside (780×1688), AuthStates 1–3 (390×760) match the boards in size, layout, copy, colours and icons. Remaining differences are the board's own DEMO strip (not a product feature) and the rounded border of the state cards (a presentation frame, not part of the screen).
- Harness fix found while reviewing the first run: `index.html` loads Telegram's real script, which replaced the stubbed `window.Telegram` and made every sheet show the outside screen. The harness now blocks `telegram.org` requests and sets a sample `VITE_TELEGRAM_BOT_USERNAME` for the Mini App server; sheets were regenerated and re-viewed.
- Component tests: `AuthGate.spec.tsx` (button calls handler, no demo text, no input fields, link href, inert link without a valid bot username, status announcement, retry handlers, no AI text).

## Results
- miniapp: 68 tests pass; lint (0 warnings), typecheck pass; ui 157 pass.

## Gaps (reported, nothing invented)
- "Syarat Layanan" / "Kebijakan Privasi" pages are not designed: the words look like links on the board but do nothing (plain styled text).
- The blocked-account message is not designed (US-006); a BLOCKED login and 503/rate-limit errors reuse "Belum bisa masuk".
