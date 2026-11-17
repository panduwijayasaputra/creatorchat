# US-021: Admin subscription detail and creator Subscriber tab

**Status:** ready_for_uat
**Priority:** high
**Feature:** customer-access
**Phase:** C
**Roles:** Admin
**Brief refs:** §11 (Creator detail: subscriber table with grant/extend/revoke and View user; User detail: View subscription; all tables), §13 (SubscriptionEvent append-only)
**Design refs:** `AdmSubDetail`, `AdmCrSubs`, `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke`, `AdmTableStates`

## Description

As an Admin, I want to see one subscription's full history and every subscriber of a creator, so that I can answer access questions from either side.

## Acceptance Criteria

- [x] **View** on a subscription row opens `/users/:id/subscriptions/:subId` matching `AdmSubDetail`: Status, Mulai, Berakhir (with time and zone), Sumber "Diberikan admin", Dibuat oleh, Pembayaran "Tidak ada transaksi", Perpanjang / Cabut Akses buttons (same dialogs as US-020), and a "Riwayat akses" table of its events (Waktu, Aktor, Tindakan, Ringkasan, Status) with pagination. "Kembali ke Langganan" returns with the previous filters kept.
- [x] The **Subscriber** tab on `/creators/:id` matches `AdmCrSubs`: server-side table of that creator's customers (Subscriber, Telegram `@username` + ID, Status akses, Mulai, Berakhir, Aksi) with "Cari nama atau Telegram ID", Status akses and Berakhir filters, sort, pagination, `AdmTableStates`. Row actions View (→ user detail) / Perpanjang / Cabut / Berikan Ulang, and **Berikan Akses** with the user picker, all reusing US-020's rules and dialogs.
- [x] The subscriber count on creator detail and the creator list (US-014/015) and the active-subscription count on user detail come from the same entitlement rule, not a stored counter.
- [x] The events table is read-only: no edit or delete in the UI or API. Event rows never show anything about payments or chat content.
- [x] A subscription id that doesn't belong to the `:id` user, or a malformed id, returns 404. Admin-only (cookie + CSRF). Screenshots at 1440 px match the boards.

## Tasks

### TASK-120: Subscription detail, events and subscribers contracts
**Status:** done

### TASK-121: Shared entitlement predicate and count refactor
**Status:** done

### TASK-122: `SubscriptionDetailService` and `CreatorSubscribersService`
**Status:** done

### TASK-123: API endpoints and admin client
**Status:** done

### TASK-124: Subscription detail page and View wiring
**Status:** done

### TASK-125: Creator Subscriber tab
**Status:** done

### TASK-126: Berikan Akses with the user picker (placeholder-flagged)
**Status:** done
