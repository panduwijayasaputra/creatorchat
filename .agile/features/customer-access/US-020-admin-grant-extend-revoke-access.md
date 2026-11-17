# US-020: Admin grants, extends and revokes access from user detail

**Status:** ready_for_uat
**Priority:** high
**Feature:** customer-access
**Phase:** C
**Roles:** Admin, System
**Brief refs:** §2, §5 (CREATOR cannot be a customer), §6, §11 (User detail: subscriptions, grant/extend/revoke; dialogs with reason), §13 (Subscription, SubscriptionEvent), §17
**Design refs:** `AdmUserSubs`, `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke`, `AdmUserSubsGranted`, `AdmUserSubsExtended`, `AdmUserSubsRevoked`, `AdmTableStates`

## Description

As an Admin, I want to grant, extend and revoke a user's access to a creator with a reason, so that customers can chat without any payment and every access change is traceable.

## Acceptance Criteria

- [ ] The **Langganan** tab on `/users/:id` matches `AdmUserSubs`: server-side table (Creator, Status Active/Kedaluwarsa/Dicabut with icon + label, Mulai, Berakhir, Aksi) with search "Cari creator", Status and Berakhir filters, Reset Filter, sort, pagination 10/25/50, the `AdmTableStates` states, and the "Tidak ada transaksi pembayaran…" note. Active rows show View / Perpanjang / Cabut; expired or revoked rows show View / Berikan Ulang.
- [ ] **Berikan Akses** opens `AdmDlgGrant`: pick an active creator, Durasi (default **30 hari**) or a custom date, computed "Tanggal berakhir" at 23.59 in the admin's display zone, required reason. Confirming creates or re-activates the single `Subscription` row for the pair, appends a `GRANT` `SubscriptionEvent` (admin, dates, reason), writes audit + an outbox event, and **creates the USER–CREATOR conversation if none exists**. The table updates and shows the `AdmUserSubsGranted` toast.
- [ ] **Perpanjang** (`AdmDlgExtend`) adds the chosen duration to the current end date (or to now if already expired) and **Cabut** (`AdmDlgRevoke`) sets `revoked_at` = now; both need a reason, append an `EXTEND` / `REVOKE` event, audit, outbox event, and show `AdmUserSubsExtended` / `AdmUserSubsRevoked`. Revoking never deletes messages or the conversation.
- [ ] Server rules, all inside one transaction that locks the subscription row: grant is refused for a non-USER or BLOCKED account (409), for a creator that is not ACTIVE (409), and for an already active subscription (409, use Perpanjang); extend/revoke refused on a revoked or expired row as appropriate (409); end date must be after start and in the future (400); empty reason → 400 with the dialog input kept.
- [ ] Double submit acts once (buttons disabled in flight; a repeated request does not add a second event). Admin-only (cookie + CSRF); user tokens get 401. Ids for another user's subscription in the URL return 404, never another user's data.
- [ ] Integration tests: grant → access active; extend moves `ends_at`; revoke → access inactive immediately; re-grant after expiry keeps earlier events; grant to a CREATOR account fails; event + audit rows carry the reason. Screenshots at 1440 px match the boards.

## Tasks

### TASK-113: Subscription access contracts
**Status:** done

### TASK-114: Migration: `subscription_events` and `conversations`
**Status:** done

### TASK-115: `SubscriptionAccessService` (backend-core)
**Status:** done

### TASK-116: `SubscriptionListService` (list and grantable creators)
**Status:** done

### TASK-117: API endpoints and admin client
**Status:** done

### TASK-118: Langganan tab (table, filters, states)
**Status:** done

### TASK-119: Grant / Extend / Revoke dialogs, toasts and visual check
**Status:** done
