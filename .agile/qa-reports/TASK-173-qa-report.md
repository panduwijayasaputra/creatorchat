# QA Report: TASK-173 — Visual check and docs

**Result:** PASS (US-029, 2026-11-17)

## Built
Three Playwright items against the boards; codebase map, design gaps and decisions log updated.

## Verified
`pnpm visual -g miniapp-cr-`: manual 23.3%, expired 6.9%, customer 12.4% from the boards. Side-by-side sheets reviewed: the differences are the omitted Phase D / F parts (AI panel, takeover and pause notes, composer hint, attach button, AI card and footnote), the avatar tone (stable hash of the conversation id, as on the inbox row) and a 2 px vertical offset of the strip text. typecheck, lint, and tests of contracts, db, backend-core, api, miniapp, admin, worker and ui pass.

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
