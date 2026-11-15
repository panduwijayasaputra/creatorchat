# US-002: Design system foundation and app shells

**Status:** ready_for_uat
**Priority:** high
**Feature:** workspace-foundation
**Phase:** A
**Roles:** USER, CREATOR, Admin (visual foundation)
**Brief refs:** §4 (navigation), §10 (visual source), §11 (tables, dialogs)
**Design refs:** `Main`, `CrMain`, `AdmMain`, `AdmTableStates`, `AdmDashTablet`/`AdmDashMobile` (shell breakpoints), `Chats` (customer bottom nav), `CrInbox` (creator bottom nav)

## Description

As a user of either app, I want every screen to share the exact look of the Claude Design handoff, so that the product feels consistent and later screens can be built quickly from ready components.

## Acceptance Criteria

- [x] Design tokens from `design-integration.md` are defined once as CSS variables and shared by both apps; Inter 400/500/600/700 and the outline icon set from the boards are available. No Tailwind/shadcn/UI library is introduced.
- [x] Shared components exist and match the foundation boards: buttons (primary, outline/secondary, danger, disabled; never wrap to two lines), input/password with "Tampilkan", status chip (icon + label for Request, Active, Blocked, Berhasil, Gagal, Kedaluwarsa, Ditolak, Menunggu, Belum mengajukan), card, kv-list, tabs, toast, confirmation dialog (target box, consequence, "Batal", verb button, processing state that blocks double clicks), and the data table frame with skeleton, empty, no-results, and error + "Coba Lagi" states per `AdmTableStates`.
- [x] Admin shell: sidebar 248 with Dashboard, Creator, User, Log & History, AI, Pengaturan; topbar 84 with breadcrumb, title, admin identity, Logout. At 1024 the sidebar becomes an 80 px rail; at 390 there's no sidebar.
- [x] Mini App shells: customer bottom nav **Chat, Jelajahi, Langganan, Profil** and creator bottom nav **Inbox, Galeri, Broadcast, Pengaturan**, with unread badge, respecting Telegram safe areas. There is no role switcher.
- [x] A local preview page renders all components, and Playwright screenshots at the foundation board widths (`Main`, `CrMain`, `AdmMain`) are compared with the PNGs. Differences are fixed or listed in the QA report.
- [x] Shells contain no feature content beyond navigation. Unbuilt destinations show a neutral placeholder clearly marked as not yet implemented (not a fake final screen).

## Tasks

### TASK-012: `packages/ui` foundation — tokens, Inter, icons, CSS Modules pipeline
**Status:** done

### TASK-013: Core primitives — Button, Field/Input/PasswordInput, Select, StatusChip, Card
**Status:** done

### TASK-014: Tabs, KvList, Toast, ConfirmDialog
**Status:** done

### TASK-015: DataTable frame with states, sorting header, pagination
**Status:** done

### TASK-016: Admin shell (sidebar 248, rail 80, mobile menu, topbar)
**Status:** done

### TASK-017: Mini App shells (customer and creator bottom navs)
**Status:** done

### TASK-018: Dev-only component preview page
**Status:** done

### TASK-019: Visual QA harness (Playwright), docs and end-to-end verification
**Status:** done
