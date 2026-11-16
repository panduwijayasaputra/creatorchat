# QA Report: TASK-061 — `/settings/timezone` screen (`CrTimezone`), settings row, date helper

**Result: PASS** (2026-11-16)

- `/settings/timezone` is under `RequireRole CREATOR`, outside the shell (own header with back link, scrolling body, sticky save bar, no bottom nav). Values and copy come from `CrTimezone.html`: five radio rows (label + `id · UTC±X` computed at render time), filled radio and check for the current choice, the "Apa yang berubah?" card with the hourglass disc, **Simpan Zona Waktu**.
- Behaviour (a real `radiogroup` with roving tabindex; arrow keys move the choice): nothing is saved until Simpan; one request on a double click; "Menyimpan…" disabled with `aria-busy` and the list dimmed; success toast; failure banner with the selection kept and a working retry; a zone outside the list starts with nothing marked; back arrow does not save; a USER is redirected and never calls the creator API.
- `CrSettings` "Zona waktu" row shows `timezoneSummary(user.timezone)` (e.g. `WITA · Asia/Makassar (UTC+8)`) and links to the real screen; it was removed from the later-story placeholder list.
- `formatDateTime` / `formatTime` (`src/format/date-time.ts`): the same UTC instant gives 07.00 / 08.00 / 09.00 in Jakarta / Makassar / Jayapura, the date rolls over correctly, Sydney follows DST, an unknown zone falls back to Asia/Jakarta and an invalid date renders "-" without throwing. No screen shows a time yet, so nothing consumes it; later stories must use it with `useAuth().state.user.timezone`.
- Placeholder copy (no board covers it): "Zona waktu disimpan", "Zona waktu belum tersimpan" and its body, in `creator-copy.ts`.
- Visual (`pnpm visual`): `miniapp-creator-timezone` (780x1688, diff 2%) reviewed side by side; layout, copy, radios, check, hourglass card and button match. Sydney shows `UTC+11` today, as in the PNG; outside daylight saving it will read `UTC+10` by design. Text is about 1 px off in places, as in the earlier screens.
- Workspace: `pnpm typecheck`, `pnpm lint`, `pnpm test` (contracts 75, db 62, backend-core 173, api 141, miniapp 156, ui 169) and `pnpm build` all pass; all 38 visual items pass; preview code is not in `dist`.

## Not verified here

- Real Telegram (WebView rendering, safe area); only jsdom and the stubbed Playwright harness.
