# QA Report: TASK-041 — Mini App — `/creators/:publicCode` route and states

**Result:** PASS

## Checked
- `creator-link.spec.tsx` (8 tests) and `api-client.spec.ts` additions (3): the deep link survives first-launch login and a returning auto-connect (path unchanged, not `/chats`); unknown code shows the designed "Creator tidak tersedia" and "Kembali ke Jelajahi" goes to `/explore`; a CREATOR sees the explanation and no lookup is made; a server `FORBIDDEN_ROLE` shows the same explanation; a network error offers a working retry; no lookup while signed out; storage holds only `cc_tg_seen`; `/` still lands USER on `/chats` and CREATOR on `/inbox`.
- `pnpm visual`: new capture `miniapp-creator-link-tidak-tersedia` (390x700) viewed by eye against the `StatesProfile` card: layout, icon, copy, button and spacing match; the board's rounded frame is board chrome and is not reproduced. 28/28 captures.
- Design gap (reported, not invented as final): the CREATOR explanation ("Link ini untuk pelanggan" / "Ke Inbox") is placeholder copy on neutral components. A valid code shows a neutral stub because the creator profile is a later story.

## Not verified here
- Real Telegram behaviour (see TASK-042).
