# QA Report: TASK-084

**Verdict:** PASS

## Verified (run)
- Component tests (`CreatorsPage.spec.tsx`, 18 cases with the fake list server): board copy, eight columns and the server range ("Menampilkan 1–10 dari 19 hasil"); "Langganan aktif" only on the flagged request; Request rows have View/Setujui/Tolak, Active shows Block, Blocked shows Unblock, both **disabled and without any call**; View opens `/creators/<id>`; applicant text with `<img onerror>` / `<b>` rendered as text; the URL is parsed with garbage values falling back one by one; every filter, sort and page-size change sends its value and resets the page (URL loses `page`); search waits for a pause, queries and resets the page; Reset Filter restores filters and keeps sort; a slow older answer cannot overwrite a newer one; a page past the end moves to the last page; loading skeleton + "Memuat data…", "Belum ada data", "Tidak ada hasil" + Reset Filter, error + Retry that never shows the thrown message; tablet = four columns, Status filter only, scroll hint, no intro; mobile = "Cari creator" + Filter button opening the panel with Status/Jenis/Tanggal and Reset.
- `list-url.spec.ts` (5 cases): defaults, round trip, per-value fallback, unknown keys ignored, reset keeps sort/size.
- Playwright `admin-creators-1440` (size match, 9.8%), `-1024`, `-390`, reviewed side by side with `AdmCreators`, `AdmCreatorsTablet`, `AdmCreatorsMobile`: toolbar, intro, columns, chips, caption, buttons, footer match at 1440; mobile shows Creator + Status first with the scroll hint.
- `DataTable` got two optional props (`bare`, `dense`), both off by default; ui 176 tests and the existing table-state screenshots unchanged.

## Known differences / notes
- Status chips' disc colours are chosen by id from the same three board colours, so individual discs differ from the boards; the boards also show photos for some creators (no photo in the fixtures).
- Block / Unblock are rendered disabled (inert until US-016), so they look faded where the board shows them enabled.
- Tablet board's Status filter reads "Semua" and the default sort is Status; the page uses the real default ("Request, Active, Blocked", Tanggal ↓). Hidden Jenis/Tanggal filters on tablet still apply if present in the URL.
- On mobile the pagination footer stacks instead of being clipped as on the board.
- The URL uses `page_size` (the API's name) instead of the plan's `size`.
- Design gaps flagged: the mobile Filter panel (plain panel with the desktop controls) and the Tanggal presets (Semua / 7 / 30 / 90 hari).
