# QA Report: TASK-034 — End-to-end verification, docs, and map

**Result:** PASS

## Checked
- `apps/api/test/user-auth.e2e.int.spec.ts` (real listening server, real HTTP, cross-origin headers): CORS preflight, login (no cookies involved), `/me`, a role change that bumps `session_version` kills the old token (401 `UNAUTHENTICATED`), a fresh login lands on the creator inbox, one user row throughout; forged data from a foreign origin is rejected and nothing leaks (no bot token or input in the error body).
- **Real wiring check** (throwaway script, deleted; built API on port 3100 against the **test** database + the Mini App Vite dev server on 5373 + headless Chromium, initData produced by `pnpm telegram:initdata`): 13 of 14 checks passed in the run that is recorded here — login over HTTP, CORS origin, `/me`, forged hash 401 `TELEGRAM_AUTH_INVALID`, old data 401 `TELEGRAM_AUTH_EXPIRED` with no user created, `/me` without a token 401; in the browser: first launch shows "Lanjutkan dengan Telegram", click lands a USER on `/chats` with the customer shell, no cookies, a returning launch connects on its own, after the role changed to CREATOR the next launch lands on `/inbox` with the creator shell, a tampered hash never reaches a shell and offers "Coba Lagi", outside Telegram "Buka di Telegram" links to `https://t.me/CreatorChatBot`.
  - The one failing check was my own assertion that browser storage holds only `{"cc_tg_seen":"1"}`: Telegram's own script also writes `__telegram__initParams` (`{}` here) to `sessionStorage`. Our code writes only `cc_tg_seen`; this is documented in `frontend.md`.
  - I narrowed that assertion and re-ran twice back to back; those two reruns failed with HTTP 429 because my earlier runs had filled the login rate limiter (20 attempts per IP per minute), so they say nothing about the app. I did not run the script a third time after the counters expired, so the narrowed assertion itself has not been seen to pass; the observed storage value in the passing-run output is the evidence.
  - Side finding: the CLI's default dev URL points at port 5173; the check needed `MINIAPP_DEV_URL` to target its own server (the first browser attempt had hit another dev server already running on 5173, which is why it showed "Sesi Telegram berakhir").
- `pnpm build` passes including the no-preview check; `apps/miniapp/dist` contains no `tgdev` and no `__preview`.
- `grep` of `apps/miniapp/src` for `localStorage|sessionStorage`: only the `cc_tg_seen` flag.
- Docs and map updated: `codebase-map.md` (endpoints, routes, entities, inventory, backlog, current state), `backend.md` ("Built in US-004"), `frontend.md`, `tech-stack.md` (four decisions), `CLAUDE.md`, `README.md`, `CONFIGURATION.md`, `.env.example`.

## Results (final run)
- `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm build`: pass.
- `pnpm test` with real PostgreSQL and Redis: contracts 30, db 50, ui 157, backend-core 104, admin 77, miniapp 68, api 71, worker 5 — all pass.
- `pnpm visual`: 27/27 captured (five new Mini App auth sheets viewed; the 22 older sheets unchanged).

## Not verified here
- Behaviour inside the real Telegram WebView (a real bot, a public HTTPS URL, Telegram's own initData). The validator matches an independently computed HMAC vector and Telegram's documented algorithm, but no real Telegram client was used.
