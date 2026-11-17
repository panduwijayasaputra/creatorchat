# QA Report: TASK-110

**Verdict:** PASS

## Verified (run)
- API integration (9 cases over HTTP with a real admin session): block revokes the live token (next `/v1/me` → 401), a new sign-in answers 403 `ACCOUNT_BLOCKED`, `no-store`, audit row with admin id and reason; subscriptions and a pending request stay; empty reason → 400 on both routes with nothing written; second block → 409 `USER_STATUS_CONFLICT` (`details.status`) and two parallel blocks → one 200, one 409, one audit row; a CREATOR → 409 `USER_ROLE_CONFLICT` for both routes, nothing written; unknown, malformed, admin-account and creator-table ids → 404 on all three routes; unblock lets the user sign in again and changes no subscription; block-check returns the live count and the list reflects BLOCKED; no session / no CSRF / a Telegram user token → 401/403 and nothing changes. api 203 tests.
