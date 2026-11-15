# QA Report: TASK-019

**Result:** PASS
**Date:** 2026-11-15

## Checked
- Full repo: pnpm typecheck (incl. visual harness), pnpm lint (0 warnings), pnpm build (incl. scripts/check-no-preview.mjs) and pnpm test pass with real PostgreSQL/Redis: contracts 14, db 34, ui 155, backend-core 16, admin 33, miniapp 32, api 25, worker 5.
- pnpm visual (Playwright 1.65.1, Chromium) captured 17 regions and laid each next to the same region of the design PNG; every sheet in visual/output/sheets was looked at.

## Visual review (reference | actual)
- Match, no visible difference beyond text content: admin sidebar 248 (2.05%), icon rail 80 at 1024 (0%), logout dialog 480x214 (same size, same copy), topbar 1440/1024, Mini App customer and creator bottom navs (same 88 px height, active bar, badge position, icon weights; 1.2-2.3%).
- Table states: loading now matches the board height exactly (451 px; skeleton rows, footer, pagination). Empty and no-results match in structure, icon, copy and buttons; remaining differences are column widths (the board uses a per-table grid) and a few px of vertical spacing in the state block.
- Status chips + buttons and palette: chip sizes, colours, icons and labels match; the card is 8 px taller because the preview page uses its own paragraph spacing.
- Mini App buttons card: button heights/radii/labels match; the board card is narrower (421 vs 443) and its outline button has an off-white fill while ours is white.

## Known differences / not verifiable
- admin-table-error: the reference PNG (AdmTableStates.png, 1760 px) is cut off before the error state's body, so only the toolbar/header can be compared; the 68.8% figure is that truncation, not a defect. The error body copy and 'Coba Lagi' button follow the board HTML.
- Topbar identity: default is a neutral 'Admin' / 'A' (the board shows 'Admin Nadia' / 'AN', a fixture).
- Mobile shell: the unread badge is absent in the shell sheets because no data source exists yet (the preview navs show it and match).
- Sticky columns and the 80 px rail/390 px topbar breakpoints were checked visually only at the three board widths.
- Main and CrMain are documentation boards, so only component cards were compared. Not built (outside acceptance): gallery tiles, chat bubbles, message-status icons, avatar/switch, status panels, charts, composer.

## Design gaps to report
- The opened state of the admin mobile '…' menu is not designed (simple list implemented).
- 'Sembunyikan' (password hide label), dialog failure copy and toast variants other than the success board are not designed; the wording used is the minimum natural opposite.
