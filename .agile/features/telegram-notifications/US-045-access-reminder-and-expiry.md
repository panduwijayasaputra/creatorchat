# US-045: Access reminder and access ended notifications

**Status:** ready_for_uat
**Priority:** medium
**Feature:** telegram-notifications
**Phase:** E
**Roles:** System, USER
**Brief refs:** §6 (active = starts_at ≤ now < ends_at, not revoked), §9 (pengingat expiry, expiry), §11 (access reminders setting), §19 (reminder defaults are an open input)
**Design refs:** `AdmSetNotif` ("Pengingat akses": "Halo {nama}, aksesmu ke {creator} berakhir {tanggal}. Hubungi admin bila ingin memperpanjang."; "Akses berakhir": "Halo {nama}, aksesmu ke {creator} sudah berakhir. Terima kasih sudah bergabung."), `AdmLogNotif` (sample "Akses berakhir 3 hari lagi")

## Description

As a USER, I want a reminder before my access to a creator ends and a message when it has ended, so that I can ask for an extension in time.

## Acceptance Criteria

- [ ] A scheduled worker job sends "Pengingat akses" once per subscription period when its end is within the reminder lead time (default 3 days, one config value), with `{tanggal}` in the customer's display timezone and a "Buka Aplikasi" button to the Langganan page.
- [ ] After `ends_at` passes, it sends "Akses berakhir" once for that period. Revoked subscriptions get neither (revoke is an admin action, not an expiry).
- [ ] If the access was extended before the job runs, the old reminder / ended notice is not sent; the new end date gets its own reminder. Blocked customer or creator → SKIPPED.
- [ ] Idempotent: re-running the job, overlapping runs or a worker restart never send the same reminder or ended notice twice (unique key per subscription period + kind). Missed runs (worker down) catch up without sending a reminder after the access already ended.
- [ ] Expiry itself stays time-based on the server (send/gallery/broadcast locks do not wait for this job); a failed notification changes nothing about access.

## Tasks

### TASK-237: Config, event types and `AccessScheduleService`
**Status:** done

### TASK-238: Reminder / ended handler
**Status:** done

### TASK-239: Worker scheduler loop, end-to-end test and docs
**Status:** done
