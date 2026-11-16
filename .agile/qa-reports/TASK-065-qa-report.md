# QA Report: TASK-065 — `/profile/creator-request` form (`CreatorRequest`, `RequestStates`, `CreatorRequestBlocked`)

**Result: PASS** (2026-11-16)

- `/profile/creator-request` is under `RequireRole USER`, outside the shell (own header with back link, scrolling body, sticky bar, no bottom nav). Values and copy come from the three boards: name prefilled from the display name, Instagram, a `radiogroup` for Creator Asli / Karakter AI (roving tabindex, arrows), textarea with a code-point counter, the rights checkbox, the info note and **Kirim Permintaan** with the send icon (never wraps).
- Validation uses the same contract schema as the server: the three board messages are verbatim; the name message is placeholder wording from the contract. Nothing is sent while invalid, the first invalid field is focused, and an error clears as soon as it is fixed. A server 400 maps to the same inline errors.
- Sending: every field and the button are disabled (`fieldset disabled`, "Mengirim…", `aria-busy`); a double click sends one request. Success goes to `/profile/creator-request/status` (placeholder owned by US-011). Failure shows "Permintaan belum terkirim" with the board text for a lost connection (placeholder text for a server error) and keeps every typed value; a retry works.
- Blocked: the "Belum bisa mengajukan" card, disabled fields and the pink disabled button, both when the state says so and when a submit gets 409 `CREATOR_REQUEST_BLOCKED` (typed values stay). A pending request redirects to the status screen; a rejected one shows the normal empty form (prefill and reason are US-011). Load failure shows a retry (placeholder copy in `creator-request-copy.ts`). A CREATOR is redirected and the request API is never called.
- API client: `getCreatorRequestState` / `submitCreatorRequest` (3 client tests incl. 409 details kept); fake API extended.
- Tests: 17 page tests; miniapp 180 pass. Visual (`pnpm visual`, 44 of 44 pass): `miniapp-creator-request` 6.5%, `miniapp-creator-request-blocked` 6.6%, the three `RequestStates` cards 10.9–16.5%. All reviewed side by side.
- Known visual differences: (1) the board shows the "Creator Asli" description wrapping to two lines (row 80 px); ours fits on one line (68 px) because the text is exactly at the wrap threshold and the font sub-pixel metrics differ from the board's Google-hosted Inter (measured: the board HTML itself renders that row at 80 px); (2) the disabled native checkbox renders grey in the blocked state, the board draws it white; (3) the validation card shows a focus ring on the first invalid field (real behaviour, the board is static); (4) the sheet fixture uses another Instagram handle.
- Workspace: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Not verified here
- Real Telegram (WebView keyboard with the sticky bar, safe area); only jsdom and the stubbed Playwright harness.
