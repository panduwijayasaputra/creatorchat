# QA Report: TASK-172 — Mini App screens `CrChatManual`, `CrChatExpired`, `CrCustomer`

**Result:** PASS (US-029, 2026-11-17)

## Built
`/inbox/:conversationId` and `/inbox/:conversationId/customer` (creator role, full screen): header with initials avatar and (i), Manual tag on my bubbles, the expired strip, ended pill and replacement panel, the customer detail with access card and Buka Chat.

## Verified
miniapp 374 tests pass (14 new component tests): Manual tag on my bubble only; no Aktifkan AI / takeover text, attach button or ids in the DOM; send with Enter, Mengirim…, Belum terkirim and Kirim Ulang; a refused send moves to the expired layout; strip, pill and panel with no composer; no pill without an end date; username with and without; USER redirected; not-found and error. The old placeholder test in `router.spec.tsx` was replaced.

## Notes
- The creator's read cursor is not written (US-030); realtime is US-031. Real Telegram untested.
- Placeholders without a board: the ended-access variant of `CrCustomer`, a customer without a username ("dari Telegram" only), not-found and error states (reuse the customer chat's).
