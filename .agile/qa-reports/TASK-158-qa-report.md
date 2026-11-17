# QA Report: TASK-158 — Mini App inbox data layer

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- `inbox-model.spec.ts` and `useInbox.spec.tsx` (15 with `useOnline`): passed. Covered: initials (one word, extra spaces, emoji, empty), time label today vs date in two zones around midnight, stable avatar tone; first page, `loadMore` once with the cursor and ignored while loading, duplicates dropped, page-2 failure keeps rows (`failed`), first-page failure + retry, filter switch with a slow older answer not overwriting, quiet refetch on tab visible, online / offline events.
