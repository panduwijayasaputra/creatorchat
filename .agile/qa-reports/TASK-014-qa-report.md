# QA Report: TASK-014

**Result:** PASS
**Date:** 2026-11-15

## Checked
- 20 new tests (118 in packages/ui) pass. ConfirmDialog: title/consequence/Batal/verb, a synchronous double click fires onConfirm once, Batal/Escape/backdrop are blocked while processing, failure keeps the dialog open with an inline fixed-text error (the thrown message is never shown) and keeps the typed reason, retry works, blank/whitespace reason blocks confirm and the reason is passed trimmed, reason is rendered as text, focus moves in / Tab and Shift+Tab wrap / focus returns to the opener, body scroll lock and release.
- Tabs: one selected tab owns the tab stop; click, Arrow keys (wrapping), Home and End. KvList: dl/dt/dd. Toast: status vs alert roles, auto-dismiss, pause on hover, max 3 (oldest dropped), clear error outside the provider.
- typecheck and lint pass.

## Deviations
- Tabs are button-based (no `to` link mode); URL-driven tabs can wrap onChange in a router navigate when needed.
- The toast has no close button (none on the AdmCreatorsToastRej board); it auto-dismisses and pauses on hover/focus.
- Added a solid red 'destructive' Button variant for the confirm button of AdmDlgBlock.
- Visual comparison is part of TASK-019.
