# QA Report: TASK-136 — Mini App request flow and result cards

**Result:** PASS (US-023, 2026-11-17)

## Built
Request buttons on `/creators/:publicCode` call the API once at a time (disabled with a sending label), refetch into `CreatorPending`; 409 refetches into the active state; failure shows an inline alert with the button enabled. `StatesAccess` cards: rejected card + "Ajukan Lagi" (GUEST / EXPIRED), approved card + "Buka Chat" (ACTIVE). Buka Chat and Lihat Riwayat Chat stay placeholders.

## Verified
Miniapp 241 tests pass (new: card states, no price/payment words, sending / failure, double tap sends one request, expired / revoked / rejected paths, 409). Playwright at board size: the two StatesAccess cards 2.9 % / 2.7 % pixel diff (font anti-aliasing), same size; the four profile boards unchanged from US-022 (known tile-grid and category-line gaps). `pnpm typecheck`, `pnpm lint` and `pnpm test` pass for the whole workspace.

## Notes
- Real Telegram untested; no payment, price or checkout anywhere.
- Placeholder copy (no board): failed-request message `Permintaan belum terkirim. Coba lagi.` and the sending label `Mengirim…` (marked in `profile-copy.ts`).
- Known limit: an admin grant from user detail leaves an older PENDING request open (US-024 must close it); the approved card can still show after a later direct grant.
