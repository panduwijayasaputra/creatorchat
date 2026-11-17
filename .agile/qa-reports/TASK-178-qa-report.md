# QA Report: TASK-178 — Visual check and docs

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- Playwright (`pnpm visual -g "miniapp-chat|miniapp-inbox"`): 12 passed. `miniapp-chat` now shows `09.05 ✓✓ Dibaca` exactly as the board (diff 22.7 %, the rest is the board's media bubbles); `miniapp-chat-expired` 15.8 % (tick + word, the board has the tick only); `miniapp-inbox` shows the Inbox tab badge "2" as the board (13.3 %; the remaining differences are the unbuilt search box and Phase F chips).
- `codebase-map.md`, `design-integration.md` (Known Gaps) updated; decisions were recorded in `tech-stack.md` when the story was planned.
- Whole workspace: `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; `pnpm test` green in every package (no other session was running tests at the time).
## Not done
- Not tried inside real Telegram; `pnpm db:seed` was not run. No realtime: the marker and badges are as fresh as the last open, refetch or navigation (US-031).
