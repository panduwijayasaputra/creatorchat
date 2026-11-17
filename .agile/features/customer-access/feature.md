# Feature: customer-access

**Phase:** C — Access & manual chat
**Roles:** USER, Admin, System
**Brief refs:** §2 (no payments; admin manages start/end dates), §4 (deep link chooses a target, grants nothing), §5 (CREATOR cannot be a customer), §6 (access rules, Minta Akses Uji Coba / Minta Perpanjangan Akses, capability table, block vs expiry), §8A (no gallery media for non-subscribers), §11 (user detail subscriptions, creator detail subscribers, grant/extend/revoke with reason), §13 (AccessRequest, Subscription, SubscriptionEvent), §17
**Design refs:** `Explore`, `CreatorGuest`, `CreatorPending`, `CreatorActive`, `CreatorExpired`, `StatesProfile`, `StatesAccess`, `Subscriptions`, `AdmUserSubs`, `AdmUserSubsGranted`, `AdmUserSubsExtended`, `AdmUserSubsRevoked`, `AdmDlgGrant`, `AdmDlgExtend`, `AdmDlgRevoke`, `AdmSubDetail`, `AdmCrSubs`, `AdmTableStates`

## Overview

Access to a creator is granted by admins, with no payment. A customer finds a creator (Explore or the bio deep link), sees the profile in one of four access states (belum berlangganan, menunggu, aktif, berakhir), and can ask for a trial or a renewal. Admins review those requests on the user detail page and grant, extend or revoke access with a required reason. Every change is an append-only `SubscriptionEvent` plus an audit row.

**One entitlement rule, evaluated on the server:** access is active when `starts_at <= now < ends_at`, it is not revoked, the customer account is ACTIVE with role USER, and the creator (and creator account) is ACTIVE. The UI never decides this. The same check guards sending messages (`manual-chat`), and later gallery (D), broadcast delivery (E) and AI (F).

A first grant also creates the USER–CREATOR conversation (one per pair), so the chat appears in the customer's Chat list and the creator's Inbox.

## Decisions (2026-11-16)

- **Access request review lives on the user detail page** (Langganan tab, `AdmUserSubs`): a pending-request banner, approve = `AdmDlgGrant` pre-filled for that creator, reject = a reject dialog following the `AdmDlgReject` pattern. The user list gets a pending-access count/filter. No separate queue page.
- **Grant dialog default duration: 30 hari** (as `AdmDlgGrant`); a custom end date is always possible. Grant end time is 23.59 in the admin's display zone (WIB in the design).
- **Re-grant after expiry** ("Berikan Ulang") updates the same `Subscription` row (UNIQUE customer + creator) and adds a `GRANT` event; history is kept.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-020 | Admin grants, extends and revokes access from user detail | high |
| US-021 | Admin subscription detail and creator Subscriber tab | high |
| US-022 | Explore and creator profile by access state | high |
| US-023 | Customer requests trial or renewal access | high |
| US-024 | Admin reviews customer access requests | high |
| US-025 | Customer Langganan page | medium |

## Depends on

- Phase B admin detail pages: US-015 (creator detail; Subscriber tab placeholder) and US-018 (user detail; Langganan tab placeholder). These stories fill those tabs.
- US-016 decision: blocking a creator blocks the account; while blocked, their subscribers have no active access.

## Out of scope here (later phases)

- Telegram messages for activation, extension, reminder and expiry ("Notifikasi aktivasi dikirim lewat Telegram" in `AdmDlgGrant`) → Phase E. Access changes write an outbox event now so Phase E can send them.
- System "Akses berakhir" rows and the `AdmLogAccess` log page → Phase E (expiry job) / G (Log & History).
- Gallery contents for active subscribers → Phase D. Phase C shows the "Galeri tersedia untuk subscriber aktif" panel for non-active states and an empty/placeholder gallery area for active ones.
- Welcome message to new subscribers (`CrWelcome*`) → after media (Phase D), planned with Phase E.

## Design gaps

- **Admin review of access requests** — not designed; decided above to reuse `AdmUserSubs` + `AdmDlgGrant` + the reject-dialog pattern. Banner copy and reject dialog copy are placeholders until designed.
- **Locked tile grid** on `CreatorGuest` / `CreatorPending` / `CreatorExpired` is omitted (Resolved Conflict #1): panel only, no tiles, durations or counts.
- **Category · city** line under the creator name (`Kuliner & slow living · Bandung`) has no input anywhere (known `profiles` gap); omit until designed.
- `CreatorPending` DEMO strip is not a product feature.
- Explore has no designed empty/error state (only `Explore` itself); reuse the `StatesChats` pattern as a placeholder and report it.
