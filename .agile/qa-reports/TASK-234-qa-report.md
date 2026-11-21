# QA Report: TASK-234 — Contracts and NotificationPreferencesService

**Result:** PASS (US-043, 2026-11-21)

## Built
Contracts `notification-preferences.ts` (strict partial-update body, exact answers, mute path and public-code check) and `muted` on `SubscriptionItemSchema`; `NotificationPreferencesService` (`get`, atomic partial `update`, `mute`, `unmute`); `CreatorAccessService.subscriptions` returns `muted` per card.

## Verified
- Contracts: 375 tests (new spec; the existing card fixtures gained `muted`).
- `notification-preferences.service.int.spec.ts` (11 cases, real PostgreSQL): defaults without a row and reading writes nothing; only the given switch changes and the first write keeps the other default; an empty patch changes nothing; two toggles of different switches at once, even as the first write, keep both and make one row; many toggles end in the last value; another user's row is never read or written; mute is one row and unmute is repeatable; unrelated, blocked, unknown and malformed creators → `not_found` with nothing stored; a blocked creator account cannot be muted; a creator blocked after the mute can still be unmuted; one customer's mute does not touch another's.
- `creator-access.service.int.spec.ts`: a muted creator shows `muted` on its own card only, for the viewer who muted it; the card key list includes `muted`.
