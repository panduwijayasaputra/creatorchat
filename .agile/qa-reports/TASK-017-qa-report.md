# QA Report: TASK-017

**Result:** PASS
**Date:** 2026-11-15

## Checked
- 29 Mini App tests pass (5 HealthStatus + 24 new): customer nav is exactly Chat/Jelajahi/Langganan/Profil, creator nav exactly Inbox/Galeri/Broadcast/Pengaturan, no cross-role entry and no role control (no button) in either shell; one aria-current item that follows the route, also on nested paths; unread badge hidden for 0/undefined, shown on the first item only with the label 'N pesan belum dibaca', caps at 99+; / redirects to /chats; every destination shows the neutral placeholder; unknown paths show a not-found placeholder; the API health indicator is kept on /chats.
- Style assertions: bottom padding is max(24px, safe area) (8+56+24 = 88 px like the boards), labels nowrap, items >= 44 px wide.
- lint, typecheck and vite build pass.

## Notes
- Both shell groups are reachable by URL for review; there is no login/role gating until US-004/US-006 (the nav is chosen by the route group, never by a UI control).
- No header is drawn (Telegram provides it). Telegram SDK / BackButton are out of scope (SDK choice still TBD); --safe-bottom already falls back to env(safe-area-inset-bottom) and --tg-safe-area-inset-bottom.
- Visual fidelity (active bar, badge position, 88 px height) is checked in TASK-019.
