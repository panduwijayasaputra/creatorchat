# QA Report: TASK-236 — Mini App Notifikasi switches, visual check and docs

**Result:** PASS (US-043, 2026-11-21)

## Built
`getNotificationPreferences` / `updateNotificationPreferences` in the API client and fake; `useNotificationPreferences` (waits for the server, optimistic tap, one request per switch with the last tap winning, a refused save restores the switch and calls `onError`); `ProfilePage` switches (label fixed to the board: "Tampilkan isi pesan"); placeholder toast "Pengaturan belum tersimpan."; the `muted` fixtures.

## Verified
- `ProfilePage.spec.tsx` (+7, 70 profile tests pass): default state once the server answered and the switches enabled; values from the server; disabled in the default state while loading and when the server cannot answer; a tap shows at once and saves only that switch; a refused save puts the switch back and shows the toast; rapid taps send one request at a time and end in the last tap; a tap during an in-flight save is sent afterwards when it differs from the confirmed state. The old "not interactive" test was replaced.
- `pnpm visual -g miniapp-profile`: size match, diff 2.2%; reviewed the sheet by eye: switches, texts and layout match `Profile`.
- Docs: codebase-map (story, endpoints, backlog), design-integration (mute control and toast still undesigned).

## Notes
- **Not built, by design:** the mute control UI. No board places the "Bisukan" switch; the API and `muted` on the cards are ready.
