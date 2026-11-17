# QA Report: TASK-070

**Verdict:** PASS

## Result
PASS.

## Verified
- 6 new `ProfilePage` tests: ProfilePending (title, chip, text, "Lihat Status" → status route, no invitation); ProfileRejected (chip, stored reason, "Perbaiki dan Ajukan Lagi" → form); HTML-looking reason as text; precedence pending > blocked > rejected > invitation; an APPROVED latest request keeps the invitation; failed load keeps the invitation (existing test).
- Playwright `miniapp-profile-pending` and `miniapp-profile-rejected` vs `ProfilePending.png` / `ProfileRejected.png`: identical structure and spacing (diff 2.3 %, text anti-aliasing and 1–2 px baseline).
- Full gate: `pnpm typecheck`, `pnpm lint`, `pnpm build` (no preview code in `dist`), all 49 `pnpm visual` items, miniapp 201 tests, ui 169, contracts 112 pass.

## Notes
- Until the state call answers, a pending user briefly sees the normal invitation (same behaviour as the US-010 blocked card); the server re-checks on submit.
