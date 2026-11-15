# QA Report: TASK-018

**Result:** PASS
**Date:** 2026-11-15

## Checked
- Admin preview (5 tests) and Mini App preview (2 tests) pass: all data-preview-section ids render; nine status chips with exact labels; the four table states from AdmTableStates; the slow dialog fires its handler once under a double click, shows aria-busy and disables Batal; the failing dialog shows its inline error; the Mini App previews both bottom navs, the unread badge, and a forced active item independent of the URL.
- The previews are registered through a dynamic import behind import.meta.env.DEV (top-level route __preview, outside the shells). scripts/check-no-preview.mjs scans apps/*/dist for the preview heading, route and fixture names and is part of pnpm build; verified it passes on the production builds and fails on a planted marker.
- lint, typecheck, vite build pass.

## Notes
- BottomNav gained an optional current prop (preview/testing) and SearchInput a large size for the Mini App search (Main board).
- Deferred (not in acceptance): gallery tiles, chat bubbles, message-status icons, avatar/switch, status panels. Blurred locked tiles are intentionally not built (design-integration conflict #1).
