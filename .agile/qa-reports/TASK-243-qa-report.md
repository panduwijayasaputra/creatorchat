# QA Report: TASK-243 — Mini App /settings/welcome

**Result:** PASS (US-040, 2026-11-21)

## Built
`WelcomePage` + `useWelcome` + copy + styles (`src/creator/welcome`); the shared `useChosenMedia` hook (`src/media-picker`); `getWelcomeMessage` / `saveWelcomeMessage` in the API client and fake; `TrashIcon`; route `/settings/welcome` (full screen, role-gated); the `CrSettings` row chip (Aktif / Mati).

## Verified
- `WelcomePage.spec.tsx` (15 cases): the saved state shows switch, text, media, note and preview bubble; off and empty for a creator who never saved one; a failed load offers Coba Lagi; back link; the save button needs text while the switch is on and allows a draft while off; the preview follows the typed text; Pilih Galeri uses the same file with its note and Hapus Media goes back; Upload Baru uses purpose WELCOME with no conversation, blocks saving until READY and shows its own note; a wrong type is refused without a request and a failed upload retries with the same id; BackButton closes the picker; Simpan Pesan sends the whole state with one PUT (trimmed text, the asset id) and confirms; no file sent when none is chosen and a double tap saves once; a failed save keeps text, switch and file and the retry sends the same body; media-gone and still-processing texts.
- `CreatorSettingsPage.spec.tsx` (+1): the row shows "Mati" / "Aktif"; router and role-gating specs include `/settings/welcome`. Full Mini App suite: 497 passed.
