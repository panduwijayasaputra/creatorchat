# Feature: telegram-notifications

**Phase:** E — Broadcast & notifications
**Roles:** USER, CREATOR, System
**Brief refs:** §4 (deep links checked after login), §6 (access states), §9 (notifications for new message, broadcast, access activation, expiry reminder, expiry, creator request result; coalesce consecutive messages; per-creator mute; hide preview by default; skip while the chat is visibly open with fresh presence; respect `retry_after`; mark bot blocked without infinite retry; notification failure never hides the message; no exactly-once claim), §11 (Pengaturan → template notifikasi / access reminders), §15 (no chat text in logs), §17 (bot failure does not hide message; blocked bot handled)
**Design refs:** `Profile` (Notifikasi: "Notifikasi pesan", "Tampilkan isi pesan"), `AdmSetNotif` (default template copy for Akses diaktifkan / Pengingat akses / Akses berakhir), `AdmLogNotif` (sample: reminder "3 hari lagi"), `RequestApproved` (bot message + "Buka Aplikasi" button pattern), `Main` (switch "Bisukan")

## Overview

Builds on the US-013 pipeline (`notification_deliveries`, outbox → `notifications` queue, bot-blocked handling, ambiguous attempts). Adds the remaining Telegram notifications: new chat messages (both directions) and broadcasts, access activated / extended, access ending soon and access ended. Each bot message has a "Buka Aplikasi" button that deep-links to the target (a chat or the Langganan page), re-checked after login. Customers control message notifications and message-content preview on their profile, and can mute one creator. Creator request result (US-013) is already built.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-042 | New message and broadcast notifications | high |
| US-043 | Customer notification settings and per-creator mute | medium |
| US-044 | Access activated notification | high |
| US-045 | Access reminder and access ended notifications | medium |

## Depends on

- US-013 (delivery table, worker, bot-blocked), US-005 (deep links), US-020 / US-024 (`subscription.granted` / `.extended` events), US-026 / US-029 (`message.created`), US-031 (presence / socket), US-039 (broadcast messages).

## Decisions to confirm with the Tech Lead

- Message notifications go both ways: customer ← creator reply / broadcast / welcome; creator ← customer message. Creators have no designed settings: on, preview hidden.
- Access notification text uses the `AdmSetNotif` default templates (`{nama}`, `{creator}`, `{tanggal}` in the recipient's display timezone). Editing the templates in the admin is Phase G; Phase E reads them from one place G can later make editable.
- Access notifications (activated / reminder / ended) are not affected by the "Notifikasi pesan" switch or by mute.
- The admin notification log (`AdmLogNotif`, retry `AdmDlgRetry`) is Phase G; Phase E only writes the delivery rows it will list.

## Design gaps

- **Per-creator mute control**: no board places it. `Main` has the "Bisukan" switch component; candidate places: the chat's "… (Opsi percakapan)" menu (US-026, currently "Fitur ini belum tersedia.") or the `Subscriptions` card. Needs a decision.
- **Bot message copy for new messages / broadcasts** (with and without content preview) and the coalesced form ("n pesan baru dari {creator}"): not designed — placeholder constants.
- Creator-side notification settings: not designed.
