# US-025: Customer Langganan page

**Status:** ready_for_uat
**Priority:** medium
**Feature:** customer-access
**Phase:** C
**Roles:** USER
**Brief refs:** §6, §10 (Langganan)
**Design refs:** `Subscriptions`

## Description

As a USER, I want one page listing every creator I have or asked for access to, so that I can see each period and act on it.

## Acceptance Criteria

- [ ] `/subscriptions` matches `Subscriptions`: one card per creator with an access relation — **Aktif** ("Akses aktif hingga …", Buka Chat, Profil), **Menunggu** ("Diminta … · menunggu persetujuan admin", Profil), **Berakhir** ("Akses telah berakhir …", Minta Perpanjangan Akses) — and the footer "Setiap creator punya periode akses sendiri…" with the account's display zone.
- [ ] Order: active first (soonest end first), then pending, then ended. Revoked access shows as Berakhir. Creators that are now blocked show without Buka Chat.
- [ ] Only my own relations are returned (USER only; CREATOR → 403). Statuses come from the server entitlement rule.
- [ ] Empty, loading and error states reuse the `StatesChats` pattern (placeholder copy, gap reported). Screenshot at 390 px matches the board.

## Tasks

### TASK-143: Langganan contracts
**Status:** done

### TASK-144: `CreatorAccessService.subscriptions`
**Status:** done

### TASK-145: API endpoint and Mini App client
**Status:** done

### TASK-146: Mini App Langganan page
**Status:** done
