# US-023: Customer requests trial or renewal access

**Status:** ready_for_uat
**Priority:** high
**Feature:** customer-access
**Phase:** C
**Roles:** USER, System
**Brief refs:** §6 (Minta Akses Uji Coba → pending TRIAL request; Minta Perpanjangan Akses → RENEWAL; no fake checkout), §13 (AccessRequest), §17
**Design refs:** `CreatorGuest`, `CreatorPending`, `CreatorExpired`, `ChatExpired`, `Subscriptions`, `StatesAccess`

## Description

As a USER, I want to ask for trial access to a creator, or a renewal when my access has ended, so that an admin can open the chat for me.

## Acceptance Criteria

- [ ] "Minta Akses Uji Coba" on `CreatorGuest` creates a `TRIAL` access request; "Minta Perpanjangan Akses" on `CreatorExpired`, `ChatExpired` and `Subscriptions` creates a `RENEWAL` request. After success the profile shows `CreatorPending` ("Permintaan akses terkirim … Dikirim <tanggal>"). No payment, price or checkout screen appears anywhere.
- [ ] The server decides the type from my current state (no subscription ever → TRIAL; expired or revoked → RENEWAL) and refuses a request while access is active (409). **One PENDING request per customer–creator pair**, enforced by a partial unique index; a repeat tap or retry returns the existing pending request, not a second row.
- [ ] Once reviewed, the profile shows the `StatesAccess` result: approved → "Akses disetujui … Berlaku hingga …" + "Buka Chat"; rejected → "Permintaan belum bisa disetujui … Ditinjau <tanggal>" + "Ajukan Lagi", which creates a new request (history kept).
- [ ] USER only (CREATOR → 403 `FORBIDDEN_ROLE`); a blocked account can't call it (401). Requests to a blocked/unknown creator → 404. The creator is chosen by public code or id from the route, never trusted for anything but choosing the target.
- [ ] Network failure keeps me on the profile with an error and the button enabled to retry; the button is disabled while sending. Each new request writes an outbox event (admin/bot notification comes later). Screenshots at 390 px match the boards.

## Tasks

### TASK-133: Access request contracts
**Status:** done

### TASK-134: `AccessRequestService` and `last_review`
**Status:** done

### TASK-135: API endpoint and Mini App client
**Status:** done

### TASK-136: Mini App request flow and result cards
**Status:** done
