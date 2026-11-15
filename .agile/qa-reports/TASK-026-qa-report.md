# QA Report: TASK-026 — End-to-end verification, docs, and map

**Result:** PASS

## Checked
- `apps/api/test/admin-auth.e2e.int.spec.ts`: a real listening server and real HTTP (a small cookie jar that honours `Path`): login, `me`, refresh (token changes), logout (cookies cleared), and a replay of the copied cookies after logout (`me` 401, refresh 401). A second test checks the refresh cookie is scoped to `/v1/admin/auth` and the access cookie to `/v1/admin`.
- **Real wiring check** (throwaway script, not part of the repo): the built API on port 3100 against the **test** database plus the admin Vite dev server (port 5290) driven over HTTP: health through the proxy, wrong password (401 `INVALID_CREDENTIALS`, attempts 1), login (200, three cookies, access cookie HttpOnly + `Path=/v1/admin`, no Domain), `me`, refresh without the CSRF header (403), refresh with it (200), logout (204, cookies cleared), `me` after logout (401), and the login page served by Vite. 12/12 passed, both before and after the vite.config fix below.
- Docs: `README.md` ("Admin login", `pnpm admin:create`, dev topology, lockout), `CONFIGURATION.md` (admin secrets, `ALLOWED_ORIGINS` also drives the Origin check, `VITE_API_BASE_URL` is not used for login), `.env.example` comment, `backend.md`, `frontend.md`, `codebase-map.md`, `tech-stack.md` (pinned `jose` 6.2.17, `@fastify/cookie` 11.1.5), `CLAUDE.md`. The `env-examples` test still passes.
- Local `.env`: the two admin secrets were generated locally (git-ignored file, values not printed) so the dev API can serve admin login.

## Defect found and fixed during this task
- `pnpm build` failed `scripts/check-no-preview.mjs` ("`__preview` found in apps/admin/dist"). Cause: my TASK-024 `vite.config.ts` called Vite's `loadEnv` on the repo-root `.env`; that file contains `NODE_ENV=development`, which Vite adopts as the build mode, so the "dev only" preview code stayed in the production bundle. The leak check caught it. Fix: `vite.config.ts` now reads only `API_PORT` by hand (documented in `frontend.md`). `pnpm build` is clean again and the admin `dist` has no Preview chunk.

## Results (final run)
- `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm build` (including the no-preview check): pass.
- `pnpm test` with real PostgreSQL and Redis: contracts 25, db 46, ui 155, backend-core 64, admin 77, miniapp 32, api 53 (unit 22 + integration 31), worker 5 — all pass.
- `pnpm visual`: 22/22 captured (5 new login sheets match the boards' sizes; the 17 older sheets unchanged).
- `grep` of `apps/admin/src` for `localStorage|sessionStorage`: only a comment.

## Notes
- The dev database has not been touched by tests; the wiring check used the `creatorchat_test` database (its `proxy.admin` row is wiped by the next test run).
- The existing seed admin in the dev database keeps its old password; nothing was reset.
