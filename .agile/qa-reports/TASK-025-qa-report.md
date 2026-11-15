# QA Report: TASK-025 — `/login` page (AdmLogin + AdmLoginStates) and visual check

**Result:** PASS

## Checked (code review)
- `LoginPage.tsx` / `login.module.css`: values from `AdmLogin.html` / `AdmLoginStates.html` (card 440 / padding 32 / radius 24 / shadow, brand block 44 px, field height 44, submit 48 px with the 12 px control radius, error panel `--err-bg` radius 20 with a 40 px white icon circle, notice strip `--pink-soft`). Built from shared `Field`, `TextInput`, `PasswordInput` ("Tampilkan"), `Button` (`loading`) and icons from `@creatorchat/ui`; copy is verbatim Indonesian from the boards.
- States: idle, validation (inline "Username wajib diisi." / "Password wajib diisi." from the contract schema, focus on the first invalid field, no request, error clears on typing), submitting ("Memeriksa…" busy pill with spinner, inputs read-only, one request even on double click or repeated Enter via a ref guard), wrong credentials (panel with "Percobaan: N dari 5" from `details.attempts`, values kept, focus back to the password), connection failure (panel + "Coba Lagi" that resubmits the kept values), success (the route guard sends the admin to the page they asked for, else `/`).
- No registration link and no "lupa password" (the boards have neither); the notice strip states there is no public sign-up.
- The password never enters the URL, logs or web storage (tested). Wrong credentials do not say which field was wrong.
- Shared UI change: `TextInput` and `PasswordInput` now declare the React 19 `ref` prop in their types (they already forwarded it at runtime).
- Visual harness: admin items now stub the session check (`/v1/admin/auth/me`) because the shell sits behind login and the harness runs without the API; login items stub the login call (hang, 401 with attempts, aborted connection).

## Design gap reported (not invented as a final screen)
- **Locked state (after 5 failures) has no board.** It reuses the board's error panel with plain facts: title "Login dikunci sementara", body "Terlalu banyak percobaan. Coba lagi dalam N menit." (or "…beberapa saat lagi." for the IP limit). The copy is mine and needs a designer's decision. The 503 and CSRF-rejected cases deliberately reuse the "Tidak bisa terhubung ke server" panel.
- No board for the login screen below 1440 px; the card simply shrinks to the viewport width minus 16 px gutters.

## Results
- `pnpm --filter @creatorchat/admin test`: 77 tests pass (21 new for the page). `typecheck`, `lint`: clean.
- `pnpm visual`: 22/22 captured (5 new). Sheets reviewed by eye in `visual/output/sheets`:
  - `admin-login-1440`, `-1-memeriksa`, `-2-validasi`, `-3-kredensial-salah`, `-4-gagal-terhubung`: all five card sizes match the boards exactly (440x508, 508, 556, 622, 622); layout, type, colors, spinner, error panel and "Coba Lagi" button match. Remaining differences are focus rings (the harness types into the fields, and the page focuses the first invalid field or the password by design) and the hover tint on the submit button after the harness click.
  - The 17 earlier sheets are unchanged (same sizes and diffs as before login existed).
