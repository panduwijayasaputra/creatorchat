# QA Report: TASK-013

**Result:** PASS
**Date:** 2026-11-15

## Checked
- 34 new tests (98 in packages/ui total) pass: Button variants/disabled/loading/keyboard/nowrap CSS/type=button; Field label+error wiring; PasswordInput toggle (type, value preserved, keyboard, never submits a form); SearchInput; Select; StatusChip (all 9 statuses render an icon and the exact label; label override keeps the icon).
- pnpm typecheck and pnpm lint pass.
- Values taken from boards: button 40/36 px radius 12 weight 600 with hover colours, secondary #F5DCE5 / hover #EBC9D6, outline border 1.5px #D8C0CA, chip 28 px radius 14 with exact colours, input 44 px, select trigger 'Status: Semua'.

## Notes / deviations
- Button adds sizes 'mobile' (48) and 'lg' (52) because the Mini App boards use larger buttons.
- PasswordInput: the toggle's name and visible text change together (Tampilkan/Sembunyikan password) instead of aria-pressed, to satisfy label-in-name. 'Sembunyikan' is not on any board.
- Visual comparison with the board PNGs happens in TASK-019.
