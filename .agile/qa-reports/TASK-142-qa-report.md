# QA Report: TASK-142 — Admin UI: Langganan banners, dialogs and /users chip and filter

**Result:** PASS (US-024, 2026-11-17)

## Built
Banners above the Langganan table with Setujui (opens the grant dialog with the creator fixed, sends `access_request_id`) and Tolak (reason dialog following the reject pattern), conflict handling, the `/users` chip and an Akses filter kept in the URL.

## Verified
admin 310 tests pass (new: banners per request, retry, approve flow, blocked account disables Setujui, 409 toasts and refetches, Tolak reason / double click / failure keeps reason / 409, hostile names as text, chip with count, filter and URL round trip, garbage URL value). Playwright: all 93 items pass; `AdmUserSubs` and the other user boards unchanged. `admin-users-1440` is 15.6 % different from the board because of the added filter: Reset Filter wraps onto its own row (see notes).

## Notes
- No board exists for the banner, the reject dialog text, the toasts or the `/users` chip and filter: placeholder copy in `copy.ts`, reported as a gap.
- Real Telegram untested; the outbox events have no consumer yet (Phase E).
