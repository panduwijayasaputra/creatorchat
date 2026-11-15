# Technical Plan: US-006 — Account status and role enforcement on every session

## Architecture Overview

Most of the session machinery exists from US-004: `UserJwtGuard` re-reads the session row, the account status and `session_version` on every request; a blocked account gets no session (403 `ACCOUNT_BLOCKED`); the Mini App already re-exchanges `initData` once on a 401 and shows "Sesi Telegram berakhir" when that fails. US-006 closes what is missing: **declared roles per endpoint**, **one place that bumps `session_version`**, **a reusable connection check for sockets**, **UI role gating**, and **the integration tests that prove all of it**.

Vertical slice: backend-core (`AccountSecurityService`, `authorizeConnection`) → API (`@Roles()` + `RolesGuard`, replacing the local check in the creator resolver) → API integration tests → Mini App (role-gated routes, blocked placeholder) → docs/map. No new migration and no new dependency (`sessions.session_version` and `users.session_version` exist since US-001/US-004). Brief refs: §3, §6 (block is not expiry), §15, §17. Design refs: `AuthMain` (rules), `AuthStates` ("Sesi Telegram berakhir" — designed, already built). Not designed (gap): the blocked-account message — placeholder copy on the existing "Belum bisa masuk" panel.

Decisions agreed with the user (2026-11-15):

| Topic | Decision |
|---|---|
| Socket check | No Socket.IO gateway yet (Phase C). Add a framework-free `authorizeConnection(token, { roles })` in backend-core with the same rules as HTTP, proven by integration tests. The Phase C gateway calls it on connect and on room joins. No Socket.IO dependency now. The "blocked user rejected on socket connect" test exercises this function, not a live socket — the report must say so. |
| Who bumps `session_version` | `AccountSecurityService.blockUser / unblockUser / changeRole` in backend-core: one transaction updates the row, increments `session_version`, revokes the user's sessions and writes an audit log. Later admin stories (Phase B/G) call it; tests call it now. |
| Mini App gating | Wrong-role routes redirect: a USER on a creator route → `/chats`; a CREATOR on a customer route → `/inbox`. `/creators/:publicCode` keeps its US-005 explanation for CREATOR. 401 mid-session → existing silent re-exchange, then "Sesi Telegram berakhir". Blocked → placeholder message. UI gating is convenience only; the server decides. |

Assumptions recorded by the Tech Lead (object if wrong):
- **Unblock does not resurrect old sessions.** `unblockUser` bumps `session_version` too, so sessions from before the block stay dead; the user logs in again via `initData`.
- **Fail closed.** `RolesGuard` rejects (500-class programming error is avoided: it answers 403 `FORBIDDEN_ROLE`) any `UserJwtGuard` route that has no `@Roles()` declaration, and a test walks every controller to prove each user route declares a role. `/v1/me` declares both roles.
- **IDOR test fixture.** No endpoint takes a user-owned ID yet (the creator code is public by design). A test-only controller (registered only in the test module, never in `AppModule`) exposes a user-scoped lookup over the `sessions` table to prove the pattern "scope by current user, another user's ID → 404"; it is written down as a hard rule in `backend.md` for later stories.
- `ErrorCode` needs no new codes (`FORBIDDEN_ROLE`, `ACCOUNT_BLOCKED`, `UNAUTHENTICATED` exist).

## Authorization & Data Rules

- **Roles:** `@Roles('USER')`, `@Roles('CREATOR')`, `@Roles('USER','CREATOR')` on every route under `UserJwtGuard`. `RolesGuard` runs after `UserJwtGuard` and compares the metadata with the role read from the **live DB row** (the session's role is not trusted from the token). Mismatch → 403 `FORBIDDEN_ROLE`, same body for every route. Admin principals never reach it (different guard/audience; verified by test both ways).
- **Identity from the session only.** `@CurrentUser()` is the sole source of user id/role. Body/query/header values named `user_id`, `role`, `telegram_id`, `x-user-id` etc. are ignored (tests send them on `/v1/me` and the resolver).
- **Session version:** a session row records `session_version` at login; `authenticate` rejects a mismatch (already built). `blockUser`/`changeRole`/`unblockUser` increment `users.session_version` and set `revoked_at` on that user's sessions inside one transaction. Idempotent: blocking an already blocked user changes nothing and does not bump again; `changeRole` to the same role is a no-op.
- **Blocked:** no new session (403 `ACCOUNT_BLOCKED`, existing), existing sessions fail with 401 on the next request. No subscription logic is touched (block ≠ expiry).
- **Audit:** `user.account.blocked`, `user.account.unblocked`, `user.role.changed` (actor = `AuditActor` passed in; tests use a system actor). No token or init data in audit metadata.
- **Connection check:** `authorizeConnection(token, { roles })` → `{ ok: true, user } | { ok: false, reason: 'unauthenticated' | 'forbidden_role' }`. It reuses `UserAuthService.authenticate`, so an admin token, a forged token, a revoked session, a stale version and a blocked account are all `unauthenticated`.
- **Events/outbox:** none. (When the socket gateway exists, a block should also disconnect live sockets; noted for Phase C.)

## Dependencies

- Packages: none new.
- Prior stories: US-001 (users, sessions, audit_logs), US-004 (`UserJwtGuard`, `UserAuthService`, Mini App auth), US-005 (the local 403 check to replace).
- Env: none.

## Risks

- **Fail-closed guard breaks an existing route.** Mitigation: the controller-scan test lists the routes and the plan updates `/v1/me` and the resolver in the same task.
- **Live-row role read adds a query.** `authenticate` already loads the user, so `RolesGuard` reuses that result (no second query).
- **Redirect loop in the Mini App.** A role with no landing (impossible today) or a redirect target that is itself gated. Mitigation: landing routes are the same ones `/` uses; a test covers both directions and `/creators/:code`.
- **Socket test is not a live socket.** Reported honestly; the gateway story must call `authorizeConnection`.

## Tasks

### TASK-043: backend-core — `AccountSecurityService` and `authorizeConnection`

Files in `packages/backend-core/src/account-security/`.

- `AccountSecurityService(prisma, audit)`:
  - `blockUser(userId, actor): Promise<{ changed: boolean }>` — in a transaction: `SELECT … FOR UPDATE` the user; if already BLOCKED return `{changed:false}`; set `status=BLOCKED`, `session_version = session_version + 1`; `sessions.updateMany({ userId, revokedAt: null }, { revokedAt: now })`; audit `user.account.blocked`.
  - `unblockUser(userId, actor)` — status ACTIVE, version bump, audit `user.account.unblocked` (old sessions stay revoked).
  - `changeRole(userId, role, actor)` — same-role no-op; otherwise set role, bump version, revoke sessions, audit `user.role.changed` with `{from,to}`. Does **not** create the `Creator` row (Phase B approval does that transactionally).
  - Unknown user → returns `{ kind: 'not_found' }` (no throw).
- `authorizeConnection(auth: UserAuthService, token: string, opts: { roles: UserRole[] })` as above.
- Export from `src/index.ts`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/account-security/account-security.service.ts` | block / unblock / changeRole |
| CREATE | `packages/backend-core/src/account-security/authorize-connection.ts` | reusable HTTP/socket identity check |
| CREATE | `packages/backend-core/src/account-security/index.ts` | barrel |
| MODIFY | `packages/backend-core/src/index.ts` | export |
| CREATE | `packages/backend-core/src/account-security/account-security.service.int.spec.ts` | real DB |
| CREATE | `packages/backend-core/src/account-security/authorize-connection.int.spec.ts` | real DB |

**Testing:**
- Block bumps the version once, revokes live sessions, writes one audit row; blocking twice does not bump again; concurrent `blockUser` calls (Promise.all) leave exactly one bump.
- `changeRole` USER→CREATOR bumps and revokes; same role no-op; unknown user → `not_found`.
- Unblock allows a new login but the pre-block token is still rejected.
- `authorizeConnection`: valid USER ok; CREATOR with `roles:['USER']` → `forbidden_role`; forged/garbage token, revoked session, stale version (after `changeRole`), blocked user, **admin access token**, expired token → `unauthenticated`.
- Audit metadata contains no token.

---

### TASK-044: API — `@Roles()` + `RolesGuard`, apply to existing user routes

- `apps/api/src/common/auth/roles.decorator.ts`: `Roles(...roles: UserRole[])` (SetMetadata).
- `apps/api/src/common/auth/roles.guard.ts`: runs after `UserJwtGuard` (`@UseGuards(UserJwtGuard, RolesGuard)`); reads metadata from handler then class; missing metadata → 403 `FORBIDDEN_ROLE` (fail closed); role from `request.user` (the live row loaded by the guard).
- `/v1/me`: `@Roles('USER','CREATOR')`. `/v1/creators/by-code/:publicCode`: `@Roles('USER')`; remove the local `forbidden_role` branch from the controller and the service (`CreatorLinkService.resolve` keeps no role knowledge). The contract and message stay `FORBIDDEN_ROLE`.
- Responses for 403 are `no-store` like the other `/v1` user routes.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/common/auth/roles.decorator.ts` | declaration |
| CREATE | `apps/api/src/common/auth/roles.guard.ts` | enforcement |
| MODIFY | `apps/api/src/modules/auth/auth.controller.ts` | `/me` declares both roles |
| MODIFY | `apps/api/src/modules/creators/creators.controller.ts` | `@Roles('USER')`, drop local check |
| MODIFY | `packages/backend-core/src/creator-link/creator-link.service.ts` (+ specs) | remove role branch |
| CREATE | `apps/api/src/common/auth/roles.guard.spec.ts` | unit |

**Testing:**
- Guard unit: allowed role passes; other role 403; no metadata 403; handler metadata overrides class.
- Existing creator-link tests keep passing with the same 403 body (they now prove the shared guard).
- Controller scan: every route using `UserJwtGuard` has `@Roles()` (fails when a future route forgets).

---

### TASK-045: API integration — session and role enforcement matrix

`apps/api/test/session-enforcement.int.spec.ts` (real PostgreSQL + Redis, built Nest app via the existing test helpers) plus a test-only module `apps/api/test/support/owned-resource.controller.ts` (never imported by `AppModule`).

- **Forged session:** random string, tampered signature, token signed with the wrong secret, token for a deleted session → 401 on `/v1/me`.
- **Role change:** login as USER, call a USER-only route (ok); `changeRole(CREATOR)`; the old token gets 401; a fresh login works and the USER-only route now gives 403.
- **Blocked:** block after login → old token 401 on HTTP; `POST /v1/auth/telegram` for the blocked account → 403 `ACCOUNT_BLOCKED` and **no** new session row; `authorizeConnection` rejects the old token and the blocked account; unblock → login works, pre-block token still 401.
- **Admin vs user:** an admin access token as Bearer on user routes → 401; a user token as the admin cookie/Bearer on `/v1/admin/auth/me` → 401.
- **Identity from the session:** `user_id`, `role`, `telegram_id` in query/body and `x-user-id`/`x-role` headers on `/v1/me`, the resolver and the test-only route are ignored.
- **IDOR:** test-only `GET /_test/owned/:id` scopes `sessions` by the current user; the caller's own id → 200; another user's session id and a random uuid → identical 404 (no "forbidden" leak).
- Wrong-role matrix: USER on a `@Roles('CREATOR')` test route → 403; CREATOR on `@Roles('USER')` → 403; both → ok on `/me`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/test/session-enforcement.int.spec.ts` | matrix above |
| CREATE | `apps/api/test/support/owned-resource.controller.ts` | test-only IDOR + role fixtures |

**Testing:** this task is the tests; the QA pass additionally runs the whole suite to confirm no leaked sessions between tests.

---

### TASK-046: Mini App — role-gated routes, blocked placeholder, session-ended path

- `RequireRole` route wrapper in `apps/miniapp/src/auth/guards.tsx`: `<RequireRole role="USER">` around the customer shell group, `<RequireRole role="CREATOR">` around the creator shell group. Wrong role → `<Navigate replace>` to that role's landing (`/chats` / `/inbox`). `/creators/:publicCode` stays outside both groups (US-005 behaviour unchanged). The role is the server's `/me` value in memory; nothing is stored.
- Blocked account (`error/blocked`): keeps the "Belum bisa masuk" panel layout but with **placeholder copy** that says the account is not active and to contact support, no retry button that loops (button stays "Coba Lagi" and re-runs login). Marked as a design gap in `design-integration.md`; copy lives in one constants file.
- "Sesi Telegram berakhir": verify the existing flow end to end — a 401 on an authorized call (after `changeRole`/block) → silent re-exchange → on success continue (new role is used for landing), on failure show `AuthStates` "Sesi Telegram berakhir". Add tests; change code only if a gap shows up.
- Update the `routes.tsx` header comment (no longer "not yet role-gated").

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/guards.tsx` | `RequireRole` |
| MODIFY | `apps/miniapp/src/app/routes.tsx` | wrap shell groups |
| MODIFY | `apps/miniapp/src/auth/screens/AuthGate.tsx` + `.module.css` | blocked placeholder copy |
| CREATE | `apps/miniapp/src/auth/role-gating.spec.tsx` | tests |
| MODIFY | `apps/miniapp/src/auth/screens/AuthGate.spec.tsx` | blocked copy |

**Testing:**
- USER opening `/inbox`, `/gallery`, `/broadcast`, `/settings` lands on `/chats`; CREATOR opening `/chats`, `/explore`, `/subscriptions`, `/profile` lands on `/inbox`; no redirect loop; correct role stays put; `/creators/:code` unaffected for both roles.
- Blocked login shows the placeholder message (no `AuthStates` expired copy); a session that turns blocked mid-use ends on the blocked panel.
- 401 → re-exchange success continues without UI flash; failure shows "Sesi Telegram berakhir" with "Coba Lagi".
- `pnpm visual`: screenshots of the blocked placeholder at 390×700 (no board exists → no pixel comparison; reported as a gap, not matched).

---

### TASK-047: Verification, docs, and map

- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm visual`.
- Wiring check against the built API (throwaway process, fake token): block a seeded user via a small script calling `AccountSecurityService`, show the old token gets 401.
- Docs: `backend.md` (roles rule: every user route declares `@Roles`, fail-closed; IDOR hard rule with the session-scoping pattern; `AccountSecurityService` is the only place that changes role/status), `frontend.md` (role gating), `design-integration.md` (blocked-message gap), `tech-stack.md` decisions log (socket check approach), `codebase-map.md` (routes, guards, services, backlog status), README note on trying a block locally.
- Story: tick acceptance criteria that are proven; list what remains for the Phase C gateway.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `.agile/guidelines/{backend,frontend,design-integration,tech-stack,codebase-map}.md` | keep docs in sync |
| MODIFY | `README.md` | local try-out |
| MODIFY | `CLAUDE.md` | current state line |

**Testing:** full suite green on a clean test DB; QA report states plainly that the socket rule is a tested function, not a live socket, and that the blocked screen has no design.
