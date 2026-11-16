# Feature: creator-applications

**Phase:** B — Profiles & applications
**Roles:** USER, Admin, System (bot/worker)
**Brief refs:** §3 (Creator role only through admin approval; same account), §5 (form, statuses, one pending per user, resubmit, active-subscription block), §9 (bot sends the application result), §11 (Creator list projection; approve/reject), §13 (`CreatorApplication`, `Subscription`, `OutboxEvent`), §14 (outbox), §17 (pending request doesn't elevate role; approval converts the same account and invalidates stale role access)
**Design refs:** `CreatorRequest`, `CreatorRequestRetry`, `CreatorRequestBlocked`, `RequestStates`, `RequestPending`, `RequestApproved`, `RequestRejected`, `ProfilePending`, `ProfileRejected`, `ProfileBlocked`, `AdmDlgApprove`, `AdmDlgApproveLoading`, `AdmDlgApproveFail`, `AdmCrApproved`, `AdmDlgReject`, `AdmDlgRejectEmpty`, `AdmCreatorsToastRej`

## Overview

A USER asks to become a creator with a short form. The request is reviewed by an admin. While it's pending or after it's rejected, the account stays USER; a rejection keeps the reason and lets the user fix the form and apply again, with all earlier requests kept as history. On approval the same account becomes CREATOR in one transaction (old sessions lose their USER access) and gets a `Creator` row with a public code. The bot tells the user the result.

A USER who still has an active or future customer subscription can't apply, and approval re-checks that inside the transaction (`AdmDlgApproveFail`). Access is never revoked automatically.

Decisions taken for Phase B (2026-11-16):
- **Minimal `Subscription` table now.** Phase B adds the table (customer, creator, starts/ends, revoked) with no grant/extend/revoke API or UI, so the "no active or future subscription" rule is real and transactional. Seed gives Raka Putra one active subscription to Salsa Maheswari until 27 Nov 2026, so the failure path is testable. Phase C builds grant/extend/revoke on this table.
- **Minimal outbox + bot send now.** Phase B adds `OutboxEvent`, the dispatcher/reconciler and one worker job that sends the application result through the bot. Phase E extends this into full notifications (preferences, mute, batching).

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-010 | Submit a creator request | high |
| US-011 | Creator request status and resubmission | high |
| US-012 | Admin approves or rejects a creator request | high |
| US-013 | Bot sends the creator request result | medium |

## Design gaps

- Bot message for a **rejected** request is not designed (only `RequestApproved` shows the approval message). Placeholder copy including the admin's reason.
- The `RequestPending` / `RequestApproved` DEMO strips are design-only and are not built.
