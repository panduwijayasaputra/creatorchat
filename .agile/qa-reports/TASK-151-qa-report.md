# QA Report: TASK-151 — Mini App chat data layer

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `chat-model.spec.ts` (7) and `useChat.spec.tsx` (10): passed; `tsc` and ESLint clean.
- Covered: merge without duplicates and in seq order; day labels in two zones around midnight, unknown zone fallback; newest page oldest-first; 404 → not-found, other failure → error; older page prepends once and a second call while loading is ignored; Mengirim… then the server message replaces the bubble; empty / whitespace / 2001 not sent; failure → failed, Kirim Ulang reuses the same id and ends with one bubble; double tap on Kirim Ulang posts once; `CHAT_ACCESS_EXPIRED` / `CHAT_CREATOR_BLOCKED` switch the state and drop the bubble; refetch on `visibilitychange` merges and drops a confirmed unsent bubble.
## Findings
- Fixed during dev: `loadOlder` read the cursor from inside a `setState` updater, so it was still null when read (caught by the test). It now reads a state ref and a busy ref.
- The refetch test sets a client id by mutating the state object: a test shortcut, noted.
