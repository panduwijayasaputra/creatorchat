# QA Report: US-016 — Admin blocks and unblocks a creator (TASK-086 … TASK-090)

**Result: PASS** (2026-11-16, self-review by the dev-team run; no separate QA agent)

## Checks run
- `pnpm typecheck`, `pnpm lint`: clean.
- `packages/contracts` vitest: 152 passed (4 new, `creator-moderation.spec.ts`).
- `packages/backend-core` `creator-moderation.service.int.spec.ts` (real PostgreSQL): 9 passed (block / unblock / conflict, two parallel blocks act once, block + unblock serialise, count ignores revoked / expired / future subscriptions, subscriptions untouched).
- `apps/api` `test/creator-moderation.int.spec.ts` (real app): 8 passed. Full api suite 217 passed. One earlier single-file run aborted once with a Nest "metatype is not a constructor" error and passed on both re-runs and in the full suite; cause not found (likely a concurrent run).
- `apps/admin` vitest: 166 passed (block / unblock dialog specs, 3 new list tests).
- Playwright at 1440 px: `admin-dlg-block` (560x465, diff 2.65 %), `admin-dlg-unblock` (560x444, 2.03 %), `admin-list-toast-unblocked` (400x48, 1.53 %). Sizes match; the existing approve dialog is 2.53 %. Visual difference seen: the board uses an avatar photo, we show initials (same as the other dialogs).

## Acceptance criteria
- Block dialog with live "N subscriber aktif", required reason, account blocked through `AccountSecurityService` (session revoked, `session_version` +1), audit with reason: met (service + API tests). `AdmCrBlockedDone` is handed to US-015 (detail page).
- Blocked creator cannot log in (403 `ACCOUNT_BLOCKED`), old token 401, deep link returns the identical 404 body (except `request_id`), history kept: met (API test).
- Unblock restores creator and account ACTIVE, audited, list toast `AdmCreatorsToastUnblock`, no subscription changed: met.
- Empty reason 400 on both routes; already blocked / not blocked 409 `CREATOR_STATUS_CONFLICT`, nothing written; double submit acts once; buttons disabled in flight: met.
- Admin only (cookie + CSRF; Telegram token and anonymous refused): met.

## Notes / not verified
- No `/__preview` section was added (the plan listed one): the dialogs open from the real list, which the visual specs use.
- The block-success toast on the list has no board; placeholder copy "{name} diblokir." (gap).
- 409 conflict toast copy is a placeholder.
- Unblocking also unblocks the account, even if it was blocked for a separate reason (accepted, see plan).
- Not tested against a real browser session with a real database in the dev UI; the API tests use the real app and test database.
