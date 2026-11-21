# US-041: Welcome message delivered once to each new subscriber

**Status:** ready_for_uat
**Priority:** medium
**Feature:** welcome-message
**Phase:** E
**Roles:** System, USER
**Brief refs:** §6, §14 (outbox, worker idempotency); Resolved Conflict #5
**Design refs:** `CrWelcome` (preview: plain creator bubble, no label), `Chat`

## Description

As a USER who just got access to a creator for the first time, I want to find the creator's welcome message in my private chat, so that the conversation starts with a greeting.

## Acceptance Criteria

- [ ] On a `subscription.granted` event for a customer's **first** access to that creator, with the creator's welcome message switched on, the worker writes one creator message (text + optional media attachment) in that conversation (created if missing) and emits `message.created` after commit.
- [ ] It looks like any other creator message: no label on the customer side, origin MANUAL is not shown to the customer, and the conversation's AI/Manual mode and `response_version` are unchanged; no AI reply is enqueued.
- [ ] Not sent on `subscription.extended`, on a renewal or re-grant after expiry/revoke, when the switch is off, when the access is no longer ACTIVE at delivery, or when the customer or creator is blocked at delivery.
- [ ] Idempotent: a duplicate event, job retry or worker crash produces at most one welcome message per customer + creator (unique key), tested with a forced retry.
- [ ] The customer can open the welcome media in the viewer under the US-037 rules; an Upload Baru welcome asset is never visible in the gallery.

## Tasks

### TASK-245: Migration and first-grant event
**Status:** done

### TASK-246: `WelcomeDeliveryService`
**Status:** done

### TASK-247: Worker welcome pipeline, end-to-end test and docs
**Status:** done
