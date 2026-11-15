# QA Report: TASK-046 — Mini App — role-gated routes, blocked placeholder, session-ended path

**Result:** PASS

## Checked
- `role-gating.spec.tsx` (12 tests): a USER opening each creator route lands on `/chats`; a CREATOR opening each customer route lands on `/inbox`; no redirect for the right role; `/creators/:code` stays reachable for both; a silent renewal that returns another role moves the app to that role's landing; a blocked login and a live session that turns blocked show the placeholder message and no navigation; an expired Telegram session shows "Sesi Telegram berakhir" with "Coba Lagi". `router.spec.tsx` creator cases now sign in as a CREATOR. `api-client.spec.ts`: the renewal notification fires only on re-exchange, not on the first login.
- `onSessionRenewed` was added to the API client and provider: without it, after a role change the silent re-exchange would have kept the old role in memory.
- `pnpm visual`: new capture `miniapp-auth-blocked-placeholder` (390x760) viewed by eye next to the "Belum bisa masuk" card: same layout and spacing, different icon and text on purpose. NO board exists for the blocked message (design gap); this is not a pixel match. 29/29 captures.

## Not verified here
- A live Socket.IO connection (no gateway exists; the rule is `authorizeConnection`, tested as a function).
- The blocked-account screen against a design (no board exists).
- Behaviour inside the real Telegram WebView.
