# QA Report: TASK-015

**Result:** PASS
**Date:** 2026-11-15

## Checked
- 37 new tests (155 in packages/ui) pass: buildPageList (1 page, few pages, '1 2 3 … 13' near the start, '1 … 6 7 8 … 13' in the middle, end window, no single-page ellipsis, clamping, never duplicates); Pagination (range text for first/middle/last/partial/zero, exactly 10/25/50, numeric page-size change, disabled prev/next, never emits the current/out-of-range page, 'Memuat data…'); DataTable (skeleton with 6 aria-hidden rows and no data rows, 'Belum ada data', 'Tidak ada hasil' + Reset Filter, error 'Data gagal dimuat' + 'Coba Lagi', rows rendered exactly as given - no client sorting, aria-sort, sort toggle asc→desc, unsortable columns have no sort button).
- typecheck and lint pass.
- Copy and values from AdmTableStates: header 12/16 600 uppercase on #FBEDF2, rows min 64 px, skeleton bars #F5DCE5 radius 7, state block 56 px icon circle, page buttons 36 px radius 10, size select 78x36.

## Notes
- Sticky start/end columns are implemented with position: sticky; this is verified visually only in TASK-019 (jsdom has no layout).
- URL-driven table state is the caller's job (admin app, later stories).
