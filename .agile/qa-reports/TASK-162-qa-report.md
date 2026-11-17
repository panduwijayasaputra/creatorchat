# QA Report: TASK-162 — Customer read cursors: seed and constraint tests (no migration)

**Result:** PASS (US-027, 2026-11-17)

## Built
No migration: `conversation_reads` comes from US-028's migration `20261127010000_inbox`. Seed gives Raka's cursors: Salsa at 0 (two creator messages unread, the board's badge 2), Kirana at her last message; upserts never move an existing cursor.

## Verified
db tests pass (105): seed twice leaves one row per pair; Salsa unread 2, Kirana 0 by the plan's formula; a cursor moved later (US-030) is not reset by the next seed.

## Notes
- Opening a chat does not clear the badge: the read cursor writer is US-030. Realtime is US-031, so counts are as fresh as the last navigation.
- Placeholder copy (no board): Muat lagi and its failure text, "Belum ada pesan", the blocked-creator row chip.
- Real Telegram untested.
