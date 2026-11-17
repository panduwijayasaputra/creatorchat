# QA Report: TASK-067

**Verdict:** PASS

## Verified (run)
- `instagramHandle`: 3 new contract cases (normal, www + trailing slash + case kept, unknown shape unchanged, never throws).
- Seed (`seed.int.spec.ts`, local PostgreSQL): Maya one PENDING, Luna one REJECTED (board reason, `reviewed_at` 2026-11-15, no reviewing admin), Raka none; second run creates 0; an existing row of the same status is left untouched.
- API (`creator-request.int.spec.ts`): rejected request returns reason + review time; pending returns the normalised submitted values with no review data; with history only the newest row is returned and the older reason/name never appear in the body; the response keys are exactly the contract (no `user_id`, no `reviewed_by_admin_id`, user id absent from the body); a submit after the account was approved (role changed) answers 401 and writes nothing.
- Full `pnpm test` (every package, with PostgreSQL and Redis running) passes; api 170 tests, miniapp 201, db 72, contracts 112. `pnpm typecheck`, `pnpm lint`, `pnpm build` and all 49 `pnpm visual` items pass.

## History
First pass (before local PostgreSQL/Redis existed on this machine) could not run the two integration specs and left the task `developed`. The role `creatorchat`, databases `creatorchat` / `creatorchat_test`, `.env` and Redis were then set up with the user's approval and the specs passed unchanged.
