# Technical Plan: US-002 — Design system foundation and app shells

## Architecture Overview

Frontend-only story. No contracts, schema, API or worker changes. It builds the shared visual foundation that every later screen reuses, then the two app shells.

Agreed with the user (2026-11-15):

- **`packages/ui` is source-only.** `exports` point at `src/*.ts(x)`; there is no `dist` and no build step. Vite (apps) and Vitest compile it, apps typecheck it through their own `tsc`. Styles are **CSS Modules** (`*.module.css`) plus one global `tokens.css`. No Tailwind, shadcn or component library.
- **Router:** `react-router` 8.5.1 (pinned after checking peers at install time) for shell navigation. **TanStack Query is not installed** here; the first story that needs API data adds it.
- **Font:** self-hosted Inter 400/500/600/700 via `@fontsource/inter` (latin subset only). Same typeface as the boards, so visually identical.
- **Playwright:** `@playwright/test` as a root devDependency, Chromium downloaded locally. `pnpm visual` is separate from `pnpm test` and is not part of the default test run.
- **Icons:** inline SVG React components copied from the boards (viewBox 24, stroke 1.75–2, round caps). The board icons are custom (e.g. circle r=9), not Lucide, so no icon library.

Brief refs: §4 navigation, §10 visual source, §11 tables/dialogs. Design refs: `Main`, `CrMain`, `AdmMain`, `AdmTableStates`, `AdmDashTablet`, `AdmDashMobile`, `AdmLogoutDlg` (dialog + topbar + sidebar), `Chats` (customer nav), `CrInbox` (creator nav), `AdmCreators`/`AdmCrActive` (tabs, kv-list), `AdmCreatorsToastRej` (toast), `AdmDlgBlock` (dialog with reason), `AdmLogin` (password field).

**Component API principle:** components are presentational and prop-driven. They take labels, counts and handlers as props; none fetch data, read the session or know a role. Board sample names and numbers (Salsa, 1.248…) appear only in the preview page, as fixtures.

## Authorization & Data Rules

- No authorization surface: no API calls, no tokens, no storage.
- **Shells do not gate access.** There is no login yet (US-003/US-004). Both Mini App shells are reachable by URL in dev so they can be reviewed; real role-based landing and enforcement come in US-004/US-006. This is a preview mechanism, **not** a role switcher: there is no UI control to change role, and the nav shown is decided by the route group only. The QA report must state this.
- Admin Logout button and Mini App unread badge are wired to props only. Logout shows the confirmation dialog but its confirm handler is a no-op placeholder until US-003; unread count has no data source until the chat stories.
- The preview page is **dev-only** (`import.meta.env.DEV`), excluded from production builds, and contains no secrets or real data.
- Unbuilt destinations render one shared `NotImplemented` placeholder (neutral, labelled "Belum tersedia" / "Halaman ini belum dibangun"). It must not imitate a final screen.
- Copy is Indonesian, verbatim from the boards.

## Dependencies

Pinned exactly after `npm view` peer checks (versions below were current on 2026-11-15; confirm peers at install):

| Package | Version | Where | Why |
|---|---|---|---|
| `react-router` | 8.5.1 | miniapp, admin | Shell routing |
| `@fontsource/inter` | latest at install, pinned | `packages/ui` | Self-hosted Inter |
| `@playwright/test` | 1.65.1 | root devDependency | Visual QA |
| `@testing-library/react`, `jsdom`, `vitest` | already installed | ui, apps | Component tests |
| `@testing-library/user-event`, `@testing-library/jest-dom` | pinned at install | ui | Dialog/tab keyboard tests |
| `@types/react`, `react`, `react-dom` | already pinned | ui | peer/dev |

- `packages/ui` gains `react` and `react-dom` as `peerDependencies`; dev copies for its own tests.
- No new env vars. No services needed beyond the existing dev servers.
- Prior stories: US-001 (workspace, Vite shells, Vitest).
- Record in `tech-stack.md`: styling decision, router/query split, font, Playwright, source-only ui (done in this planning step).

## Risks

- **Fidelity drift.** Mitigation: values copied from `html/` into tokens/CSS; a Playwright harness screenshots the preview sections and the shells at board widths, with side-by-side sheets that a human reviews. A pixel-diff percentage is informational only. `Main` and `CrMain` are documentation boards, not app screens, so they are compared per component card, not full page.
- **Source-only package + CSS Modules in Vitest/tsc.** Mitigation: TASK-012 proves the pipeline end to end first (a Button test, `vite build` in both apps, `tsc` with a `*.module.css` declaration file) before components multiply.
- **`tsc` with `rootDir`/`include` across a source-only workspace package.** Mitigation: `packages/ui/tsconfig.json` uses `noEmit`; apps resolve through `exports`; `moduleResolution: NodeNext` requires `.js`-style specifiers in ui source, kept consistent with the repo rule.
- **Design gap — admin mobile menu.** `AdmDashMobile` shows a "…" menu button at 390 but no board shows what it opens. Plan: a minimal disclosure list reusing the sidebar item style (six destinations + Logout), clearly recorded as a gap in the QA report. If the user prefers, this can be left as a visible-but-disabled button instead.
- **Design gap — dialog variants.** Only block/logout/etc. examples exist. The generic `ConfirmDialog` covers the pattern from `DESIGN.md` (target box, consequence, optional required reason, Batal, verb, processing). Reason field styling is taken from `AdmDlgBlock`.
- **Charts are out of scope.** The acceptance list does not include charts and no chart is in the shells. Chart components arrive with the dashboard story.
- **Overruled design items.** Do not build the blurred locked tile grid from `Main`; the "Media tile dan panel galeri" card in the preview shows only photo/video/uploading/failed/new/selected tiles and the "Galeri tersedia untuk subscriber aktif" panel (design-integration #1). Tiles are not required by this story's acceptance list; build only if cheap, otherwise defer to the gallery story. Plan: **defer tiles and chat bubbles** (not in acceptance) and note it.
- **Fonts in Telegram WebView / CSP.** Self-hosting avoids third-party requests; Vite emits hashed woff2 assets.

## Tasks

### TASK-012: `packages/ui` foundation — tokens, Inter, icons, CSS Modules pipeline

Turn the placeholder `packages/ui` into a source-only package and prove the pipeline.

- `package.json`: `exports` `"."` → `./src/index.ts`, `"./tokens.css"` → `./src/styles/tokens.css`, `"./fonts.css"` → `./src/styles/fonts.css`; remove `build`/`dist`; `typecheck` = `tsc --noEmit`; `test` = `vitest run`; peerDeps react 19.3.1; dep `@fontsource/inter`.
- Remove `packages/ui` from root `build:packages` (no build) while keeping it in typecheck/test. Verify the root scripts still run.
- `src/styles/tokens.css` — every token from `design-integration.md` as a CSS custom property on `:root`: colors (`--bg --pink --pink-soft --rose --rose-hover --ink --ink-2 --ink-2-pressed --line --field --ok-fg --ok-bg --warn-fg --warn-bg --err-fg --err-bg --exp-fg --exp-bg`), secondary-button hover `#EBC9D6` as `--pink-hover`, radii (`--radius-control: 12px`, `--radius-card: 16px`, `--radius-dialog: 20px`, `--radius-chip: 14px`), shadows (`--shadow-1`, `--shadow-2`), backdrop `--backdrop`, heights (`--h-button: 40px`, `--h-button-table: 36px`, `--h-input: 44px`, `--touch-min: 44px`), font stacks (`--font-sans`, `--font-mono`), safe-area helpers (`--safe-bottom: env(safe-area-inset-bottom, 0px)`).
- `src/styles/base.css` (exported as `"./base.css"`): box-sizing, body font/color/background, `:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px }`, `button { white-space: nowrap }`, reduced-motion respect.
- `src/styles/fonts.css`: imports only the latin 400/500/600/700 files of `@fontsource/inter` and sets `font-display: swap`.
- `src/icons/` — one component per icon, `Icon` props `{ size?: number; title?: string }`, `aria-hidden` unless `title`; icons copied from the boards: status (hourglass, check-circle, user-slash, alert-circle, x, info-circle, clock), nav (chat bubble, compass, bookmark, user, image, megaphone, sliders, users, sparkle), UI (search, chevron down/up/left/right, eye, refresh/rotate, calendar, dots, logout-x, lock). Source each path from `html/` (`AdmMain`, `Chats`, `CrMain`, `AdmDashTablet`); no invented glyphs.
- `src/css-modules.d.ts`: `declare module '*.module.css'`.
- `src/index.ts` exports icons and (later) components.
- Both apps import `@creatorchat/ui/fonts.css`, `tokens.css`, `base.css` once in `main.tsx`; add `@creatorchat/ui` as `workspace:*` dependency.
- `apps/*/vite.config.ts`: no change expected (Vite compiles workspace sources); confirm `server.fs` allows the workspace path and fix if not.
- `scripts` — a `tokens.spec.ts` unit test that parses `tokens.css` and asserts every token in the list above exists with the exact value from `design-integration.md`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `packages/ui/package.json` | Source-only exports, deps, scripts |
| MODIFY | `packages/ui/tsconfig.json` | noEmit, jsx, include src |
| DELETE | `packages/ui/tsconfig.build.json` | No build step |
| CREATE | `packages/ui/vitest.config.ts` | jsdom, CSS Modules, setup file |
| CREATE | `packages/ui/test/setup.ts` | jest-dom matchers |
| CREATE | `packages/ui/src/styles/{tokens,base,fonts}.css` | Tokens, base rules, Inter |
| CREATE | `packages/ui/src/styles/tokens.spec.ts` | Token values match the guide |
| CREATE | `packages/ui/src/icons/*.tsx`, `index.ts` | Inline SVG icons |
| CREATE | `packages/ui/src/css-modules.d.ts` | CSS Modules typing |
| MODIFY | `packages/ui/src/index.ts` | Public exports |
| MODIFY | `package.json` (root) | Drop ui from `build:packages` |
| MODIFY | `apps/miniapp/{package.json,src/main.tsx}`, `apps/admin/{package.json,src/main.tsx}` | Depend on and load ui styles |

**Testing:**
- Token spec: all tokens present with exact values; no token missing from `design-integration.md`.
- Icon smoke test: each icon renders an `svg` with `aria-hidden="true"` (no title) or a `role="img"` + label (with title).
- Pipeline: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `vite build` for both apps pass with a CSS Module imported from `packages/ui`; built CSS contains the token variables and woff2 files are emitted (no request to a Google host in output).

---

### TASK-013: Core primitives — Button, Field/Input/PasswordInput, Select, StatusChip, Card

Match `Main` ("Komponen dasar"), `AdmMain` ("Status dan tombol"), `AdmLogin` (password field).

- `Button`: variants `primary | secondary | outline | danger | ghost-link` (the "Kirim Ulang" underlined link style from `Main`); props `{ variant, size?: 'md'|'table', icon?: ReactNode, loading?: boolean, disabled?: boolean, ...button attrs }`. 40 px (36 in tables), radius 12, weight 600, `white-space: nowrap`, never wraps (text ellipsis is not allowed either; test the nowrap style). Disabled style = `Nonaktif` pink look. `loading` sets `aria-busy`, disables clicks and keeps width.
- `Field` (label, hint, error, `id` wiring via `useId`), `TextInput` (44 px, radius 12, border `--field`, focus ring), `PasswordInput` with toggle button whose labels are exactly **"Tampilkan"** / **"Sembunyikan"** (confirm the hide label in `AdmLogin` HTML), `type` switches text/password, toggle is a real button with `aria-pressed`, input value is preserved; `autoComplete` passthrough.
- `SearchInput` (search icon + clearable text, used by tables; pattern from `AdmTableStates`).
- `Select` — native `<select>` styled to match the "Status: **Semua**" dropdown trigger (label prefix + bold value + chevron); keeps native accessibility and mobile pickers.
- `StatusChip`: closed set `request | active | blocked | success | failed | expired | rejected | pending | none` mapped to the exact label + icon + colors: `Request`(warn, hourglass), `Active`(ok, check), `Blocked`(err, user-slash), `Berhasil`(ok, check), `Gagal`(err, alert), `Kedaluwarsa`(exp, clock), `Ditolak`(err, x), `Menunggu`(warn, hourglass), `Belum mengajukan`(neutral pink, info). Always renders icon **and** label; 28 px tall, radius 14. Customer-side labels from `Main` ("Aktif", "Berakhir") come from an optional `label` override prop, keeping icon + colors.
- `Card` (radius 16, border `--line`, white), `CardTitle`.
- Exports from `packages/ui/src/index.ts`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/ui/src/components/button/{Button.tsx,Button.module.css,Button.spec.tsx}` | Button |
| CREATE | `packages/ui/src/components/field/{Field,TextInput,PasswordInput,SearchInput}.tsx` + css + specs | Inputs |
| CREATE | `packages/ui/src/components/select/{Select.tsx,Select.module.css,Select.spec.tsx}` | Dropdown |
| CREATE | `packages/ui/src/components/status-chip/{StatusChip.tsx,StatusChip.module.css,StatusChip.spec.tsx}` | Status |
| CREATE | `packages/ui/src/components/card/{Card.tsx,Card.module.css}` | Card |
| MODIFY | `packages/ui/src/index.ts` | Exports |

**Testing:**
- Button: renders each variant; `disabled` and `loading` block `onClick`; nowrap style applied; keyboard Enter/Space activates.
- PasswordInput: toggles type and label; value preserved; toggle reachable by keyboard; `aria-pressed` correct.
- StatusChip: each status renders both an icon and its exact label (table-driven over all 9); never color-only.
- Field: label associated with input, error announced through `aria-describedby`/`aria-invalid`.
- Select: change handler fires; prefix label + value shown.

---

### TASK-014: Tabs, KvList, Toast, ConfirmDialog

Match `AdmCrActive`/`AdmUserSummary` (tabs, kv-list), `AdmCreatorsToastRej` (toast), `AdmDlgBlock` + `AdmLogoutDlg` (dialog).

- `Tabs` — controlled/uncontrolled, `role="tablist"`, arrow-key navigation, rose underline on the active tab, supports `href`-style usage (render as links when `to` provided so detail tabs can live in the URL later); `aria-selected`, roving tabindex.
- `KvList` — definition-list (`dl`) rows, label left (`--ink-2`) and value right, divider lines, matching the detail summaries.
- `ToastProvider` + `useToast()`; toasts appear top-right, dark (`--ink` background) with success/error icon + message; auto-dismiss after 5 s (configurable), manual close, `role="status"` (success) / `role="alert"` (error), max 3 stacked, pauses on hover/focus. Not part of the mobile Mini App spec; Mini App can reuse it later.
- `ConfirmDialog` — props `{ open, title, icon?, target?: ReactNode (identity box), consequence: ReactNode, reason?: { label, required, minLength?, placeholder? }, cancelLabel = 'Batal', confirmLabel: string (specific verb, required), destructive?: boolean, onConfirm: (reason?: string) => Promise<void> | void, onClose }`.
  - Radius 20, backdrop `--backdrop`, icon circle (pink/err) as in `AdmLogoutDlg`.
  - **Processing state:** while `onConfirm` is pending, the confirm button shows loading, is disabled and ignores re-clicks (guard with a ref, not just state, so two synchronous clicks fire once), Batal, Escape and backdrop click are disabled, and focus stays inside.
  - On rejection the dialog stays open, shows an inline error (`role="alert"`) and keeps the typed reason; on success it closes.
  - Required reason: confirm disabled until non-blank (trimmed); reason text is rendered as text only.
  - Accessibility: `role="dialog"` + `aria-modal`, labelled by title and described by consequence, focus trap, focus moves to the first field/Batal on open and returns to the opener on close, Escape closes when not processing, body scroll lock.
  - Uses a portal (`document.body`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/ui/src/components/tabs/{Tabs.tsx,Tabs.module.css,Tabs.spec.tsx}` | Tabs |
| CREATE | `packages/ui/src/components/kv-list/{KvList.tsx,KvList.module.css,KvList.spec.tsx}` | Key-value list |
| CREATE | `packages/ui/src/components/toast/{ToastProvider.tsx,Toast.module.css,Toast.spec.tsx}` | Toast |
| CREATE | `packages/ui/src/components/dialog/{ConfirmDialog.tsx,ConfirmDialog.module.css,ConfirmDialog.spec.tsx}` | Dialog |
| MODIFY | `packages/ui/src/index.ts` | Exports |

**Testing:**
- ConfirmDialog: double synchronous click on confirm calls `onConfirm` exactly once; Batal/Escape/backdrop ignored while processing; failure keeps dialog open with inline error and preserves reason; required reason blocks confirm for empty/whitespace; focus is trapped and restored; labels use the supplied verb.
- Tabs: ArrowLeft/ArrowRight/Home/End move selection; `aria-selected` correct.
- Toast: success vs error roles; auto-dismiss with fake timers; pause on hover; max 3.
- KvList: renders `dl/dt/dd` pairs.

---

### TASK-015: DataTable frame with states, sorting header, pagination

Match `AdmTableStates` (all four states) and the table in `AdmDashTablet`/`AdmLogoutDlg`.

Presentational and **server-driven**: the component never sorts, filters or slices data itself (frontend.md: no client-side filtering of everything).

- `DataTable<Row>` props: `columns: { key, header, sortable?, sticky?: 'start'|'end', render(row), width? }[]`, `rows`, `status: 'loading'|'ready'|'error'` (empty and no-results derived from `rows.length === 0` plus a `hasActiveFilters` flag), `sort: { key, direction } | null`, `onSortChange`, `rowKey(row)`, `emptyState?`, `errorMessage?`, `onRetry`.
- `TableToolbar`: slot for `SearchInput`, `Select` filters and the **Reset Filter** ghost button with the refresh icon; calls `onReset`.
- Header: uppercase 13/600 labels on `--pink-soft`, sort arrow icon (up/down, active column darker), `aria-sort`, sort buttons are real buttons.
- States per `AdmTableStates`: **skeleton** (6 pink rows, widths varied but deterministic, `aria-busy`, footer "Memuat data..."), **empty** ("Belum ada data" / "Data akan muncul di sini setelah ada aktivitas." with the image icon in a pink circle), **no results** ("Tidak ada hasil" + message + outline "Reset Filter" button), **error** (read `AdmTableStates` lower section for exact copy; message + "Coba Lagi" button calling `onRetry`).
- `Pagination` footer: "Menampilkan a–b dari N hasil" (0 results → "Menampilkan 0 hasil"), "Baris per halaman" select with **10/25/50**, page buttons `1 2 3 … N` with current in rose, previous/next with disabled state; props `{ page, pageSize, total, onPageChange, onPageSizeChange }`; pure `buildPageList(page, pageCount)` helper (unit tested). Changing page size or total resets page is the caller's job, but the component never emits an out-of-range page.
- Sticky identity/action columns on horizontal scroll (`position: sticky` with `--bg` background and a divider shadow); table scrolls horizontally inside its card at narrow widths.
- A "View" action is the caller's column (`Button variant=outline size=table icon=eye`); expose a `ViewButton` convenience.
- URL-query table state is the caller's responsibility; export a small `useTableQueryState()` hook **in the admin app** (not ui) in a later story. Out of scope here.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/ui/src/components/data-table/{DataTable.tsx,TableToolbar.tsx,TableStates.tsx,Pagination.tsx,page-list.ts,DataTable.module.css}` | Table frame |
| CREATE | `packages/ui/src/components/data-table/{DataTable.spec.tsx,page-list.spec.ts,Pagination.spec.tsx}` | Tests |
| MODIFY | `packages/ui/src/index.ts` | Exports |

**Testing:**
- `buildPageList`: 1 page, 5 pages, 13 pages at page 1/7/13 (matches `1 2 3 … 13`), never duplicates, always includes first/last/current.
- Pagination: range text correct for first/middle/last/partial page and total 0; prev disabled on page 1; next disabled on last; page size options exactly 10/25/50.
- DataTable: each of loading/empty/no-results/error renders its exact copy; "Coba Lagi" calls `onRetry`; "Reset Filter" calls `onReset`; sort header toggles call `onSortChange` and set `aria-sort`; rows are rendered exactly as given (no client-side sorting).

---

### TASK-016: Admin shell (sidebar 248, rail 80, mobile menu, topbar)

Boards: `AdmLogoutDlg` and `AdmDashboard` (1440), `AdmDashTablet` (1024), `AdmDashMobile` (390).

- Add `react-router` to `apps/admin`. Routes: `/` Dashboard, `/creators`, `/users`, `/logs`, `/ai`, `/settings`, plus a catch-all not-found within the shell. Every destination renders `NotImplemented` ("Halaman ini belum dibangun") inside the shell. Real routes per the Admin Route Map come in later stories; `/login` is **not** created here (US-003).
- `AdminShell` (layout route): sidebar + topbar + `<Outlet/>`.
  - **≥ 1280:** sidebar 248 with logo mark + "Creator Chat" / "Admin", nav items Dashboard, Creator, User, Log & History, AI, Pengaturan (icons as boards), active item = pink-soft fill + rose label/icon + 3 px left bar, `aria-current="page"`.
  - **~1024 (≥ 768 and < 1280):** 80 px icon rail (logo mark, six icon links, accessible names via `aria-label` + `title`).
  - **< 768 (390 board):** no sidebar. Topbar shows the "…" menu button (44 px) at the left and the avatar chip at the right; the button opens a menu listing the six destinations + Logout (**design gap**: the opened menu is not designed; reuse sidebar item styling; record in QA report). Menu is a disclosure with `aria-expanded`, closes on route change and Escape.
  - Breakpoints use CSS media queries (no JS width detection) so there is no layout flash.
- `Topbar` 84 px (80 on mobile per board): breadcrumb line (small) + page title H1 (breadcrumb/title derived from a route `handle` `{ title, breadcrumb }` so later routes just declare it), admin identity block (`AN` avatar circle, name, role "Administrator", chevron — display-only; props `{ name, role }`, defaulting to a clearly neutral placeholder until US-003 supplies the real admin; **no hard-coded Admin Nadia in production code**), and the **Logout** outline button (X icon).
- Logout opens `ConfirmDialog` with the exact copy from `AdmLogoutDlg` ("Keluar dari dashboard?", consequence text, "Batal", "Logout"); confirm handler is a prop wired to a no-op for now with a code comment pointing to US-003; it must show the processing state and close.
- Accessibility: skip-to-content link, `<nav aria-label="Navigasi utama">`, `<main id>`, focus ring tokens.
- Main background `--bg`; sidebar background `--pink-soft` with `--line` right border (verify values in `AdmDashTablet.html`).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/admin/package.json` | `react-router`, `@creatorchat/ui` |
| CREATE | `apps/admin/src/app/{router.tsx,routes.ts}` | Route table with `handle` titles |
| CREATE | `apps/admin/src/components/shell/{AdminShell,Sidebar,Topbar,MobileMenu,LogoutDialog}.tsx` + `shell.module.css` | Shell |
| CREATE | `apps/admin/src/components/NotImplemented.tsx` | Placeholder |
| MODIFY | `apps/admin/src/{main.tsx,App.tsx,App.spec.tsx}` | Mount router, keep the API health indicator inside the Dashboard placeholder so US-001 health display is not lost |
| CREATE | `apps/admin/src/components/shell/AdminShell.spec.tsx` | Tests |

**Testing:**
- Renders all six nav items with correct labels and hrefs; active item has `aria-current` on each route; unknown route renders not-found inside the shell.
- Breadcrumb/title come from route handles.
- Logout opens the dialog with exact copy; Batal closes without calling the handler; confirm calls it once even on double click.
- Mobile menu: opens/closes, `aria-expanded`, closes on navigation and Escape.
- The existing health indicator test still passes (move assertions, don't delete coverage).
- Layout breakpoints are CSS-only; verified visually in TASK-019, not in jsdom.

---

### TASK-017: Mini App shells (customer and creator bottom navs)

Boards: `Main` and `Chats` (customer nav), `CrMain` and `CrInbox` (creator nav). 390 px width.

- Add `react-router` to `apps/miniapp`.
- `BottomNav` in `apps/miniapp/src/components/` (Mini App-only; not needed in admin): `items: { to, label, icon, badge?: number }[]`; 88 px tall, `padding: 8px 8px max(24px, var(--safe-bottom))`, top border `--line`, background `--bg`; active = 3 px rose bar on top of the item, rose label (600) and thicker icon (2 px stroke); inactive `--ink-2`; unread badge (`min-width 18`, rose, white 11/700, positioned top-right of the icon; `aria-label="N pesan belum dibaca"`, caps display at "99+"; hidden when 0/undefined); each item ≥ 44 px touch target; `aria-current="page"`; labels never wrap.
- Variants (config arrays, **no role switcher control**):
  - Customer: **Chat** (`/chats`), **Jelajahi** (`/explore`), **Langganan** (`/subscriptions`), **Profil** (`/profile`).
  - Creator: **Inbox** (`/inbox`), **Galeri** (`/gallery`), **Broadcast** (`/broadcast`), **Pengaturan** (`/settings`).
- `CustomerShell` and `CreatorShell` layout routes: content area scrolls inside, nav fixed to bottom; `100dvh` layout so mobile browser chrome and the keyboard don't break it; content bottom padding equals the nav height. Mini App draws no header (the Telegram header is native).
- Routes (from the proposed map): `/` redirects to `/chats`; customer: `/chats`, `/explore`, `/subscriptions`, `/profile`; creator: `/inbox`, `/gallery`, `/broadcast`, `/settings`. All render `NotImplemented` (mobile-sized). A not-found route renders a neutral placeholder. The existing health indicator remains on the `/chats` placeholder.
- The unread badge count is a prop with no source yet; the shell passes `undefined`. The preview page shows `2` (as in the boards) via a fixture.
- Telegram integration (BackButton, safe-area events, SDK) is **not** part of this story (SDK choice still TBD; US-004). Only CSS `env(safe-area-inset-*)` and `--tg-safe-area-inset-*` fallbacks: define `--safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tg-safe-area-inset-bottom, 0px))` in tokens (adjust TASK-012 token accordingly) and document it for US-004.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/package.json` | `react-router`, `@creatorchat/ui` |
| CREATE | `apps/miniapp/src/app/{router.tsx,nav-config.ts}` | Routes + the two nav configs |
| CREATE | `apps/miniapp/src/components/{BottomNav.tsx,BottomNav.module.css,NotImplemented.tsx}` | Nav and placeholder |
| CREATE | `apps/miniapp/src/components/shell/{CustomerShell,CreatorShell}.tsx` + css | Shells |
| MODIFY | `apps/miniapp/src/{main.tsx,App.tsx,App.spec.tsx}` | Mount router, keep health indicator |
| CREATE | `apps/miniapp/src/components/BottomNav.spec.tsx`, `src/app/router.spec.tsx` | Tests |

**Testing:**
- Customer nav shows exactly Chat, Jelajahi, Langganan, Profil; creator nav shows exactly Inbox, Galeri, Broadcast, Pengaturan (assert there is no cross-role item and no role-switch control in either shell).
- Active item follows the route; `aria-current` set on exactly one item.
- Badge: hidden for 0/undefined, shows count, caps at 99+, has the Indonesian accessible label.
- `/` redirects to `/chats`; unknown path renders the not-found placeholder.
- Safe-area padding present in the nav's computed CSS source (string assertion on the module, since jsdom can't evaluate `env()`).

---

### TASK-018: Dev-only component preview page

- Each app gets a `/__preview` route registered only when `import.meta.env.DEV` (tree-shaken from production builds; a build-output test asserts the string `__preview` and fixture names such as "Salsa" are absent from the production bundle).
- Admin preview (`apps/admin/src/preview/Preview.tsx`): sections that mirror `AdmMain` ("Palet dan tipografi", "Status dan tombol") and `AdmTableStates` (all four table states, 1440 width), plus Inputs (Field/Password/Select/Search), Tabs, KvList, Toast triggers, and ConfirmDialog triggers (plain, with required reason, forced failure, slow-processing to demonstrate the blocked double click).
- Miniapp preview (`apps/miniapp/src/preview/Preview.tsx`): sections mirroring `Main` ("Komponen dasar": tombol, input/composer-style search, status chips, panel status, both bottom navs side by side — customer and creator with unread badge `2`).
  - Do not build the blurred gallery tiles, chat bubbles, message status icons, gallery tile and avatar/switch components in this story (not in acceptance); list them in the codebase-map as "foundation boards: partially implemented" with the remaining components.
- Fixture data lives only in `preview/` folders and is clearly labelled; none of it is imported by shells.
- `data-preview-section="<id>"` attributes on each card so Playwright can capture them individually.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/admin/src/preview/{Preview.tsx,preview.module.css,fixtures.ts}` | Admin preview |
| CREATE | `apps/miniapp/src/preview/{Preview.tsx,preview.module.css,fixtures.ts}` | Mini App preview |
| MODIFY | `apps/admin/src/app/router.tsx`, `apps/miniapp/src/app/router.tsx` | DEV-only route |
| CREATE | `apps/*/src/preview/Preview.spec.tsx` | Renders without errors; all sections present |

**Testing:**
- Preview renders in jsdom with all `data-preview-section` ids.
- Production build of each app does not contain preview code or fixtures (script check on `dist`).
- Dialog demo "slow confirm" fires its handler once under double click (reuses the ConfirmDialog guarantee through the real page).

---

### TASK-019: Visual QA harness (Playwright), docs and end-to-end verification

- Root devDependency `@playwright/test` 1.65.1; add to `allowBuilds` only if pnpm requires; install Chromium with `pnpm exec playwright install chromium` (local only; document in README; browser binaries are not committed).
- `visual/` folder at the root: `playwright.config.ts` (starts nothing; expects `pnpm dev` on 5173/5174 with a clear error if not up, or uses `webServer` against `vite preview` — pick the simpler; document), `visual/specs/*.spec.ts`, `visual/compare.mjs`.
  - Captures, with `reducedMotion: 'reduce'`, fonts awaited (`document.fonts.ready`), fixed viewport:
    - Admin shell at 1440, 1024, 390 vs `AdmLogoutDlg`/`AdmDashboard` (shell chrome only), `AdmDashTablet`, `AdmDashMobile` — the compare is of the **chrome regions** (sidebar/rail/topbar), cropped; page content differs by design because the dashboard isn't built.
    - Admin preview sections vs `AdmMain` (status chips, buttons) and `AdmTableStates` (4 states), cropped per `data-preview-section`.
    - Mini App preview sections vs `Main` (buttons, input, chips, panels, bottom nav) and `CrMain` (creator bottom nav), cropped.
    - Mini App shells at 390×844 vs `Chats` and `CrInbox` — bottom nav region only.
  - Outputs to `visual/output/` (git-ignored): actual, reference crop, and a side-by-side sheet per item, plus a JSON with informational diff percentages. No pass/fail threshold is enforced in `pnpm test`.
- Root script `pnpm visual` (not part of `pnpm test`/`build`). `.gitignore` adds `visual/output/`.
- **Review step (human-style, by the dev/QA agent):** open every side-by-side sheet and judge it; fix differences (spacing, weights, colors) or list the remaining ones in the QA report with the reason. Do not claim fidelity from a number alone. Also record that `Main`/`CrMain` are documentation boards so only component cards are compared.
- Docs sync: `codebase-map.md` (new ui components, shells, routes, preview page, foundation inventory row = "partially implemented", Feature Backlog row), `frontend.md` (decisions that became concrete: source-only ui, CSS Modules, router, preview), `tech-stack.md` (pinned versions: react-router, @fontsource/inter, @playwright/test, testing libs; remove "Proposed" from router/styling/font rows — updated in this planning step for the decisions, versions added by the dev), `README.md` (`pnpm visual`, Chromium install, preview URLs), `CLAUDE.md` Commands/Current State if stale.
- Final verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` clean; `pnpm dev` serves both apps; the preview pages and shells load; `pnpm visual` produces sheets; QA report lists remaining differences and gaps (admin mobile menu, undesigned dialog variants, deferred components).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `package.json` (root) | `@playwright/test`, `visual` script |
| CREATE | `visual/{playwright.config.ts,compare.mjs}` | Harness |
| CREATE | `visual/specs/{admin-shell,admin-preview,miniapp-preview,miniapp-shell}.spec.ts` | Captures |
| MODIFY | `.gitignore`, `eslint.config.js`, `.prettierignore` | Ignore outputs; lint the visual folder |
| MODIFY | `README.md`, `CLAUDE.md`, `.agile/guidelines/{codebase-map,frontend,tech-stack}.md` | Docs sync |

**Testing:**
- The harness itself: a unit test for `compare.mjs` size-normalisation (different-size inputs don't crash).
- Manual/agent review of every side-by-side sheet, recorded in the QA report.
- Full repo checks as above.

---
