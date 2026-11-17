# QA Report: TASK-153 — Seed fixtures, visual check and docs

**Result: PASS** (2026-11-17, self-review by the dev-team run; no separate QA agent)

## Checks run
- Seed: `CHAT_FIXTURES` (Raka ↔ Salsa 3 messages, Raka ↔ Kirana 4); `seed.int.spec.ts` (seed twice: 7 then 0, seq 1..n, `last_message_seq`, senders): passed.
- Docs: `codebase-map.md`, `design-integration.md` (Known Gaps), `tech-stack.md` (decisions log) updated. TASK IDs were renumbered from 143–149 to 147–153 because US-025 (built in parallel) took 143–146.
- Whole workspace: `pnpm typecheck`, `pnpm lint`, `pnpm build` clean; `pnpm test` green in every package (after adding `messages` to the baseline table allowlist). The Nest ERROR lines in the API output come from webhook tests that simulate failures.
## Not done
- `pnpm db:seed` was not run on the dev database (it prints a one-time admin password); run it to get the two chats locally.
