# US-044: Access activated notification

**Status:** ready_for_uat
**Priority:** high
**Feature:** telegram-notifications
**Phase:** E
**Roles:** System, USER
**Brief refs:** §6, §9 (aktivasi akses), §11 (template notifikasi)
**Design refs:** `AdmSetNotif` (template "Akses diaktifkan": "Halo {nama}, aksesmu ke {creator} sudah aktif sampai {tanggal}. Selamat mengobrol."), `AdmDlgGrant` / extend dialog (promise a Telegram notification), `RequestApproved` (button pattern)

## Description

As a USER, I want a Telegram message when an admin grants or extends my access to a creator, so that I know I can start chatting and until when.

## Acceptance Criteria

- [ ] `subscription.granted` and `subscription.extended` events (admin grant / extend, approved access request) send the "Akses diaktifkan" template to the customer with `{nama}`, `{creator}` and `{tanggal}` = new end date and time in the customer's display timezone, plus a "Buka Aplikasi" button deep-linking to the chat with that creator.
- [ ] Not sent if, at delivery, the subscription was revoked, has already ended, or the customer or creator is blocked (delivery recorded as SKIPPED with a reason).
- [ ] Not affected by "Notifikasi pesan" or mute. Bot blocked / `retry_after` / ambiguous timeout handled as in US-013; one notification per event (idempotent on retry).
- [ ] The access change itself never depends on the notification: a failed send leaves the subscription active and the delivery row FAILED for a later admin retry (Phase G).

## Tasks

### TASK-218: Shared Telegram delivery runner and router
**Status:** done

### TASK-219: Access-activated handler, templates and date formatting
**Status:** done

### TASK-220: Worker wiring, end-to-end test and docs
**Status:** done
