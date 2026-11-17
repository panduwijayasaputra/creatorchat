# QA Report: TASK-176 — API endpoints

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `apps/api/test/chat-read.int.spec.ts` (13) plus `roles-declared.spec.ts`; full API suite 357 passed; ESLint clean.
- Covered: no token 401; CREATOR on the customer route and USER on the creator routes 403 `FORBIDDEN_ROLE`; blocked customer / creator 401; IDOR (another customer or creator, unknown, non-uuid) → one identical 404 body and nothing stored (no row, no event); 400 for negative, float, string, null, missing and an extra `user_id`; forward-only and clamped over HTTP; the caller moves only their own cursor; works after expiry; the creator reading clears the inbox row, the Belum Dibaca list, `unread_conversations` and `…/unread`; the customer sees `peer_read_seq` follow it; the customer's chat unread clears after the customer reads; the creator inbox answer carries no cursor of the customer.
