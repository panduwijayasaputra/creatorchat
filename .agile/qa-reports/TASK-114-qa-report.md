# QA Report: TASK-114 — Migration: subscription_events and conversations

**Result:** PASS (US-020, 2026-11-16)

**Evidence:** packages/db: 6 integration tests (append-only trigger, reason CHECK, RESTRICT FKs, one conversation per pair); `prisma migrate diff` shows no drift. Applied to the TEST database only.

Checks run: `pnpm typecheck`, `pnpm lint`, `pnpm test` (all packages, 0 failures).

**Notes / honest limits**
- The seed was not extended with access events or an expired Kirana subscription (events need an admin author and the existing seed tests count one subscription); use the UI to create demo data.
- `subscription.*` outbox events stay PENDING: no handler until Phase E, so no Telegram message is sent.
- Not exercised: real Telegram, a browser's native date picker (the custom-date popover is undesigned), the dev database migration (not applied here).
- Visual: View buttons are disabled until US-021; creator photos are placeholders in fixtures; the user avatar colour is one rule while the boards colour it differently per dialog.
