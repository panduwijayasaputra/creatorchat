# US-014: Admin creator list

**Status:** ready_for_uat
**Priority:** high
**Feature:** admin-accounts
**Phase:** B
**Roles:** Admin
**Brief refs:** §11 (Creator list: projection of applications + creator accounts; columns; filters; actions), §11 "Semua tabel", §17
**Design refs:** `AdmCreators`, `AdmCreatorsTablet`, `AdmCreatorsMobile`, `AdmTableStates`

## Description

As an Admin, I want one list of pending creator requests and creator accounts, so that I can find anyone quickly and act on them.

## Acceptance Criteria

- [ ] `/creators` renders `AdmCreators` 1:1 (and the tablet/mobile boards at 1024/390 px): columns Creator, Telegram (`@username`, ID), Instagram, Jenis, Status (Request / Active / Blocked, icon + label), Subscriber (active count; "–" for requests), Tanggal, Aksi. Rows with a pending request whose user has an active/future subscription show "Langganan aktif" under the chip.
- [ ] The list is a server-side projection: PENDING applications (still USER accounts) + Creator accounts. Rejected or approved applications are not shown as their own rows; a rejected request is never shown as Blocked. Default status filter is "Request, Active, Blocked".
- [ ] Search (name or Telegram ID), filters Status / Jenis / Tanggal, column sort and pagination (10/25/50) run on the server with an allowlist of sort fields; an unknown sort or filter value returns 400. Totals and "Menampilkan x–y dari n hasil" come from the server. Reset Filter restores defaults; changing a filter resets to page 1; filters and sort are kept in the URL and survive going to a detail page and back.
- [ ] Row actions: View → `/creators/:id` (US-015); Request → **Setujui** / **Tolak** (US-012); Active → **Block**; Blocked → **Unblock** (US-016). Loading, empty, no-results and error-with-retry states follow `AdmTableStates`.
- [ ] Admin-only endpoint (admin cookie; user token → 401). Integration tests prove filters, sort and pagination change the backend result, and no private chat data is returned. Screenshots at 1440/1024/390 px match the boards.
- [ ] **(wiring from US-012)** **Setujui** / **Tolak** on a Request row open `ApproveRequestDialog` / `RejectRequestDialog` (built in US-012, `apps/admin/src/creators/`) with that row's application id. After a decision the table refetches: a rejection shows the toast (`rejectedToast`, `AdmCreatorsToastRej`) and the row leaves the default filter, an approval turns the row into Active, and an 'already reviewed' answer just refreshes the row with the current status. Screenshots match `AdmDlgApprove*`, `AdmDlgReject*` over the list and `AdmCreatorsToastRej`.

## Tasks

### TASK-081: Creator list contract
**Status:** done

### TASK-082: `CreatorListService` (the projection)
**Status:** done

### TASK-083: `GET /v1/admin/creators` and the admin client
**Status:** done

### TASK-084: `/creators` list page (desktop, tablet, mobile)
**Status:** done

### TASK-085: Wire the approve / reject dialogs and the rejection toast
**Status:** done
