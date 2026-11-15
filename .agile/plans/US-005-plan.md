# Technical Plan: US-005 — Bot entry and creator deep links

## Architecture Overview

Vertical slice: contracts → one migration (`Creator`) → `backend-core` (start-payload parsing, bot reply builder, `CreatorLinkService`) → API (grammY webhook, creator-link resolver) → CLI (`pnpm telegram:webhook`) → Mini App (`/creators/:publicCode` route + states). Brief refs: §4 (entry flow, link pattern), §1, §14 (webhook secret, quick handler), §15. Design refs: `AuthMain` ("Tujuan setelah login"), `StatesProfile` ("Creator tidak tersedia" — **designed**, built 1:1), `CrSettings` (bot link sample). Not designed (gap): "CREATOR opened another creator's link" explanation — neutral placeholder.

Decisions agreed with the user (2026-11-15):

| Topic | Decision |
|---|---|
| Destination transport | The bot's `web_app` button opens `MINIAPP_URL/creators/<public_code>`. The destination is the URL path itself: the router sits under `AuthProvider`, so it survives login with no redirect, no stored state. The code only picks a route; the server resolves it after login. |
| Start payload | `/start c_<code>` where the payload matches `^c_[A-Za-z0-9_-]{1,62}$`. Matching payloads are URL-encoded into the path (no raw concatenation). Anything else (no payload, other prefix, junk) → open the Mini App **without** a destination. The bot does not look the creator up (no DB in the webhook path, nothing to leak). A well-formed but unknown code is handled by the Mini App resolver → "Creator tidak tersedia". |
| `public_code` | Server-generated, 8 chars, lowercase base32 (`a-z2-7`), immutable, UNIQUE. Link: `https://t.me/<bot>?start=c_k4m9x2qa`. Unguessable; a readable slug can be added to the Creator profile later. |
| Bot copy | Placeholder Indonesian copy in one constants file (undesigned; listed as a gap): welcome "Selamat datang di Creator Chat. Ketuk tombol di bawah untuk membuka aplikasi." / creator link "Ketuk tombol di bawah untuk membuka profil creator." / button "Buka Creator Chat". |

Assumptions recorded by the Tech Lead (object if wrong):
- **Webhook reply, no queue.** The handler answers `/start` using grammY's webhook reply (the reply is the HTTP response body), so there is no outbound Bot API call inline and BullMQ is not needed yet. Slow work (notifications etc.) uses the queue in Phase E. `botInfo` is supplied from config (`id` from the token prefix, `username` from `TELEGRAM_BOT_USERNAME`) so the first request does not call `getMe`.
- **Menu button** is set by the CLI (`setChatMenuButton` → `web_app` → `MINIAPP_URL`), not at API startup. Registering the webhook/menu changes a real bot, so it only happens when the user runs the CLI with their own token. No automatic registration, no tunnel picked.
- **Role check on the resolver is local to this story.** `GET /v1/creators/by-code/:code` is USER-only; a CREATOR gets 403 `FORBIDDEN_ROLE`. US-006 generalizes this into a shared roles guard and a reusable code.
- **A CREATOR opening their own link** is treated the same as another creator's (the explanation + Inbox).
- **Seed fixture creator** (`public_code` fixed, user is a CREATOR fixture) so the flow can be tried locally. Real creators are created by approval in Phase B, which will generate `public_code` with the shared generator.

## Authorization & Data Rules

- **Webhook** `POST /v1/telegram/webhook`: public route, protected only by the `X-Telegram-Bot-Api-Secret-Token` header compared to `TELEGRAM_WEBHOOK_SECRET` in constant time **before the body is parsed**. Missing/wrong secret → 401 (generic body, nothing logged beyond request ID). Secret or token unset → 503 `SERVICE_UNAVAILABLE`; the rest of the API still boots; integration status reports `telegram_webhook: unconfigured`. Body limit stays 1 MiB. No rate limiter (the secret is the gate); the handler never throws to Telegram for unsupported updates (answers 200 with no reply) so Telegram does not retry-storm.
- The handler reads only `message.text` of private chats starting with `/start`. It never stores or logs update content, usernames or payloads; logs carry request ID and outcome only. The bot token never appears in logs, errors or health output (existing redaction + a test with a captured log stream).
- **Resolver** `GET /v1/creators/by-code/:publicCode` (`UserJwtGuard`, role USER): `publicCode` validated with the contract schema (malformed → the same 404 as unknown, so shape alone leaks nothing). Lookup is `creator.findFirst({ where: { publicCode, status: ACTIVE, user: { status: ACTIVE } } })`. Missing / blocked creator / blocked creator account / malformed → **404 `CREATOR_NOT_FOUND`**, identical body and no timing-relevant extra work. Response carries only `public_code`, `display_name`, `avatar_url` — no ids, no role, no subscription state, no media data. The call grants nothing (no subscription, no role, no conversation is created).
- CREATOR caller → 403 `FORBIDDEN_ROLE` (checked from the live user row by the guard, never from the client). No customer access is created and the role is never changed.
- **Data:** `Creator` is minimal: `id`, `user_id` UNIQUE FK → `users`, `public_code` UNIQUE (+ CHECK format), `status` `CreatorStatus {ACTIVE, BLOCKED}`, timestamps. The creator profile fields (bio, type, persona, price, …) arrive with Phase B. `ON DELETE RESTRICT`. DB CHECK that the linked user has role CREATOR is **not** added in SQL (cross-table; Phase B approval enforces it transactionally per backend.md rule 9); the fixture respects it.
- **Idempotency:** `/start` replies are stateless and safe to repeat (Telegram may redeliver an update). No audit rows for ordinary link opens (high volume, no state change).
- **Events:** none (no outbox, no queue, no socket in this story).

## Dependencies

- Packages: `grammy` **1.46.0** (npm registry checked 2026-11-15; engines node ≥ 14.13, so Node 24 is fine; ESM/CJS dual). Pin exactly in `apps/api` (the webhook) and the CLI's workspace; record in the `tech-stack.md` pinned-versions table and decisions log. No other new dependency. Source: https://grammy.dev/ (webhook callback, `webhookCallback(bot, 'fastify')`, `secretToken`) — dev re-checks the Fastify adapter API against the docs at install.
- Env (all exist in `.env.example` / `env.ts`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (new requirement: ≥ 32 chars, different from the bot token; in production enforced by the schema, in dev short/unset → 503), `MINIAPP_URL` (https; used to build the button URL), `API_PUBLIC_URL` (CLI webhook target). Client: `VITE_TELEGRAM_BOT_USERNAME` already exists (US-004).
- Prior stories: US-001 (db, health, integration status), US-004 (`UserJwtGuard`, `/me`, Mini App auth/provider, `StatesProfile` styling pieces).
- Deploy/real Telegram: not done here. Needs a bot token, HTTPS tunnel/domain and `MINIAPP_URL` from the user; the tunnel is the user's choice.

## Risks

- **Real Telegram not testable here.** The webhook is tested with `app.inject()` and hand-built updates; `/start` rendering, the menu button and the in-WebView open of `/creators/<code>` need a real bot + HTTPS (UAT input). Report plainly; the dev-signed `?tgdev=` path is not "Telegram integration".
- **MINIAPP_URL must serve the SPA fallback** for `/creators/<code>` (Vite dev does; production hosting must rewrite to `index.html`). Documented in README/CONFIGURATION.
- **Telegram may drop long/odd start payloads**; payload charset is limited to `[A-Za-z0-9_-]` by Telegram, and we cap at 64 chars.
- **Webhook-reply** responses cannot be inspected for delivery failure; acceptable for a greeting. If a later story needs guaranteed sends it moves to the queue.
- **`getMe` avoidance**: if `botInfo` is wrong (e.g. id from the token prefix mismatches), grammY still handles updates; covered by a test that no outbound request happens during the webhook call.
- **Role guard duplication** with US-006: the 403 here is local; US-006 must not regress the code/shape (test pins `FORBIDDEN_ROLE`).
- **Enumeration:** the resolver is authenticated and uniformly 404s; the 8-char random code (32^8) is not brute-forceable at the existing limits. A resolver rate limit is not added now (authenticated; reuse of the limiter is cheap if Pilot hardening wants it) — noted for Phase H.
- Creator profile UI does not exist: a valid code shows a neutral stub ("Profil creator" with the display name) and is reported as pending the Phase B/C profile story.

## Tasks

### TASK-035: Contracts — public code, creator-link resolution, error codes

`packages/contracts/src/creator-link.ts`, exported from `index.ts`:
- `PUBLIC_CODE_LENGTH = 8`, `PUBLIC_CODE_PATTERN = /^[a-z2-7]{8}$/`, `START_PAYLOAD_PREFIX = 'c_'`.
- `PublicCodeSchema = z.string().regex(PUBLIC_CODE_PATTERN)`.
- `StartPayloadSchema = z.string().regex(/^c_[A-Za-z0-9_-]{1,62}$/)` (what the bot accepts — wider than `PublicCodeSchema` on purpose so unknown-but-wellformed codes still reach the resolver and get the designed "tidak tersedia" state).
- `creatorPath(code)` → `/creators/${encodeURIComponent(code)}`; `CREATOR_LINK_PATH_PREFIX = '/creators'`.
- `CreatorLinkResponseSchema` (strict): `{ public_code: string, display_name: string, avatar_url: string | null }`.
- `errors.ts`: add `CREATOR_NOT_FOUND`, `FORBIDDEN_ROLE` (check it is not already present; do not duplicate).

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/contracts/src/creator-link.ts` (+ `.spec.ts`) | schemas, constants, `creatorPath` |
| MODIFY | `packages/contracts/src/errors.ts`, `errors.spec.ts` | two codes |
| MODIFY | `packages/contracts/src/index.ts` | export |

**Testing:**
- Valid/invalid public codes (length, uppercase, digits 0/1/8/9, unicode, empty); start payload accepts `c_k4m9x2qa`, `c_UNKNOWN`, rejects `c_`, `x_abc`, spaces, `;`, 70 chars; response schema is strict; `creatorPath` encodes unsafe input; new codes in the catalogue.

---

### TASK-036: Database — `Creator` table (minimal) and seed fixture

Migration `20261117010000_creator_public_code`:
- enum `CreatorStatus { ACTIVE, BLOCKED }`.
- `creators`: `id` uuid pk (`gen_random_uuid()`), `user_id` uuid NOT NULL UNIQUE FK → `users(id)` ON DELETE RESTRICT, `public_code` text NOT NULL UNIQUE with CHECK `public_code ~ '^[a-z2-7]{8}$'`, `status` `CreatorStatus` NOT NULL DEFAULT `ACTIVE`, `created_at`/`updated_at` timestamptz(3).
- `schema.prisma`: `model Creator` mapped to `creators`; `User.creator Creator?`. Nothing else (no profile fields).
- Seed: one CREATOR fixture user + `Creator` with a fixed `public_code` (e.g. `salsa234`) from the design seed data; idempotent upsert; never touches an existing admin. Apply with `migrate deploy`/`migrate dev` on the local dev DB only; never reset.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/db/prisma/migrations/20261117010000_creator_public_code/migration.sql` | table, enum, CHECK |
| MODIFY | `packages/db/prisma/schema.prisma` | `Creator`, `CreatorStatus`, relation |
| MODIFY | `packages/db/seed/*` | fixture creator (idempotent) |
| CREATE | `packages/db/test/creator.int.spec.ts` | constraint tests |
| MODIFY | `packages/db/src/testing.ts` (only if the truncate list needs `creators`) | clean test DB |

**Testing (integration, test DB):**
- Insert with a valid code works; duplicate `public_code` rejected; second creator row for one user rejected; bad format (uppercase, 7 chars, `0`/`1`) rejected by CHECK; deleting a user that has a creator is rejected (RESTRICT); seed runs twice → one creator; existing US-001…004 suites stay green.

---

### TASK-037: backend-core — start payload, bot reply builder, `CreatorLinkService`

New folder `packages/backend-core/src/creator-link/`:
- `public-code.ts`: `generatePublicCode(random = randomBytes)` → 8 chars from `a-z2-7` using unbiased sampling (32 symbols, one byte masked with `& 31` — no modulo bias); `isPublicCode(value)`.
- `start-reply.ts`: pure `buildStartReply({ payload, miniAppUrl }): { text, buttonText, url }`. Payload accepted only if `StartPayloadSchema` matches; then `url = new URL(creatorPath(code), miniAppUrl)` (so the origin can never change), otherwise `url = miniAppUrl` (no destination). Copy strings in `bot-copy.ts` (placeholder copy from the plan; the single place to change). Returns `null` when `miniAppUrl` is not configured (handler then replies with nothing).
- `creator-link.service.ts`: `CreatorLinkService.resolve(db, { code, caller: { id } })` → `{ kind: 'ok', creator: { publicCode, displayName, avatarUrl } } | { kind: 'not_found' } | { kind: 'forbidden_role' }`. Reads the live caller (role from the DB, not a parameter) and the creator with the scoped query from the plan. Takes the Prisma client explicitly.
- Export from `index.ts`; extend `config/integrations.ts` so the status includes `telegramWebhook: 'configured' | 'unconfigured'` (token + username + secret ≥ 32 chars + `MINIAPP_URL` all present); update its spec.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `packages/backend-core/src/creator-link/public-code.ts` (+ `.spec.ts`) | generator + guard |
| CREATE | `packages/backend-core/src/creator-link/start-reply.ts`, `bot-copy.ts` (+ `.spec.ts`) | pure reply builder |
| CREATE | `packages/backend-core/src/creator-link/creator-link.service.ts` (+ `.int.spec.ts`) | resolve |
| MODIFY | `packages/backend-core/src/index.ts`, `config/integrations.ts` (+ spec) | exports, status |

**Testing:**
- Generator: always matches the pattern; 10 000 codes have no duplicates and use the whole alphabet; injected random source is deterministic.
- `buildStartReply`: `c_k4m9x2qa` → URL path `/creators/k4m9x2qa`; unknown well-formed code still builds a URL; empty/absent/other-prefix/oversized/injection payloads (`c_../../x`, `c_a?b`, `c_<script>`, `//evil.com`, `@evil.com`) → plain `miniAppUrl`, and the result's origin always equals the configured origin; no `miniAppUrl` → `null`.
- Service (real test DB): active creator resolves with only the three fields; unknown, malformed, BLOCKED creator, creator whose user is BLOCKED → identical `not_found`; CREATOR caller → `forbidden_role` for another creator's code and their own; no row is written (no subscription, conversation, role or session change); caller role is read from the DB even if a stale value exists elsewhere.

---

### TASK-038: API — Telegram webhook (grammY)

`pnpm add -E grammy@1.46.0` in `apps/api` (re-check the Fastify adapter docs).
In `apps/api/src/modules/telegram-webhook/`:
- `telegram-webhook.module.ts`, `telegram-webhook.controller.ts`: `POST /v1/telegram/webhook` (public, no user/admin guard). A small guard/handler step compares `X-Telegram-Bot-Api-Secret-Token` to `TELEGRAM_WEBHOOK_SECRET` with `timingSafeEqual` (length-checked) **before** any grammY processing; mismatch/missing → 401 (empty-ish generic error envelope); unconfigured → 503. Then `webhookCallback`-style handling with webhook reply, a short handler timeout, and a global `bot.catch` that logs only the error name + request ID.
- `telegram-bot.factory.ts`: builds the `Bot` with `botInfo` from config (no `getMe`), registers `bot.command('start', …)` using `buildStartReply` for private chats only (groups/channels ignored); every other update type → acknowledged with 200 and no reply.
- Wiring in `app.module.ts`; `Cache-Control: no-store`; the existing request-ID/redaction apply. Add `x-telegram-bot-api-secret-token` and the update body to the log-redaction paths if not covered (never log the body).
- The webhook controller must not be affected by the user CORS allowlist (Telegram sends no Origin); verify CORS does not reject it.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/telegram-webhook/telegram-webhook.module.ts`, `.controller.ts`, `telegram-bot.factory.ts` | webhook |
| MODIFY | `apps/api/src/app.module.ts`, `app.factory.ts` | wiring, no-store |
| MODIFY | `apps/api/package.json`, `pnpm-lock.yaml` | grammy 1.46.0 |
| CREATE | `apps/api/test/telegram-webhook.int.spec.ts` | HTTP tests with a fake Bot API |

**Testing (Fastify inject; a fake Bot API transport, never the real Telegram):**
- Correct secret + `/start c_k4m9x2qa` → 200 with a `sendMessage` webhook-reply body whose button URL is `MINIAPP_URL/creators/k4m9x2qa`; `/start` alone and the junk payloads from TASK-037 → button with the bare Mini App URL.
- Missing secret, wrong secret, wrong length, secret in the query string → 401 and **no** handler ran (assert via a spy); malformed JSON with a correct secret → 200/400 without a crash and without leaking the body.
- Unsupported update (edited message, callback query, group `/start`, channel post, empty body) → 200, no reply, no retry-causing status.
- Secret or token unset → 503 while `/v1/health` still answers and the integration status shows `telegramWebhook: unconfigured`.
- No outbound HTTP request happens during a webhook call (no `getMe`, no `sendMessage`); the token, secret and update text never appear in captured logs; the response is fast (assert it completes without awaiting any external call).

---

### TASK-039: API — `GET /v1/creators/by-code/:publicCode`

In `apps/api/src/modules/creators/`: `creators.module.ts` (imports `AuthModule`), `creators.controller.ts` — `@UseGuards(UserJwtGuard)`, validates the param through `PublicCodeSchema` (a malformed code maps to the same 404 as unknown), calls `CreatorLinkService.resolve`, maps `not_found` → 404 `CREATOR_NOT_FOUND` and `forbidden_role` → 403 `FORBIDDEN_ROLE`, returns `CreatorLinkResponse`. `Cache-Control: no-store`. Wire into `app.module.ts`. A short comment points at US-006 for the shared roles guard.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/src/modules/creators/creators.module.ts`, `creators.controller.ts` | resolver |
| MODIFY | `apps/api/src/app.module.ts` | wiring |
| CREATE | `apps/api/test/creator-link.int.spec.ts` | HTTP integration tests |

**Testing (real DB + Redis):**
- USER + valid code → 200 with exactly `public_code`, `display_name`, `avatar_url` (assert no id/status/role/subscription keys); creates no subscription, conversation, session or role change.
- Unknown code, malformed code (`ABCDEFGH`, 7 chars, `../x`), BLOCKED creator, BLOCKED creator's account → byte-identical 404 bodies except `request_id`.
- No token, expired token, revoked session, BLOCKED caller, admin token as Bearer → 401; CREATOR caller → 403 `FORBIDDEN_ROLE` for another creator's code and for their own; a forged `role=USER` in header/query/body is ignored.
- A stale `session_version` token loses access (guard from US-004).

---

### TASK-040: Dev tooling — `pnpm telegram:webhook`

`scripts/telegram-webhook.ts` (tsx): subcommands `info` (reads `getWebhookInfo`), `set` (`setWebhook` to `${API_PUBLIC_URL}/v1/telegram/webhook` with `secret_token` from `TELEGRAM_WEBHOOK_SECRET`, `allowed_updates: ['message']`, `drop_pending_updates` only with `--drop-pending`; plus `setChatMenuButton` `web_app` → `MINIAPP_URL`), `delete`. Refuses when `NODE_ENV=production`, when the token/secret is unset or a placeholder (`<set-locally>`), when `API_PUBLIC_URL`/`MINIAPP_URL` is not https, and prints exactly what it is about to change and asks for `--yes` (non-interactive safe default = dry run). Never prints the token or secret; the Bot API base URL is injectable so tests use a fake server. Documents in README ("Connect the bot locally": tunnel is the user's choice) and `CONFIGURATION.md` (`TELEGRAM_WEBHOOK_SECRET`, `MINIAPP_URL`, SPA fallback requirement). Root `package.json` script.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `scripts/telegram-webhook.ts` (+ `scripts/telegram-webhook.spec.ts`) | webhook/menu CLI |
| MODIFY | `package.json`, `README.md`, `CONFIGURATION.md`, `.env.example` | script + docs |

**Testing (fake Bot API server only):**
- `set` without `--yes` makes no request (dry run); with `--yes` sends the expected `setWebhook` + `setChatMenuButton`; refuses production, placeholder token, short secret, http URLs; token and secret absent from stdout/stderr.

---

### TASK-041: Mini App — `/creators/:publicCode` route and states

In `apps/miniapp/`:
- `src/creator-link/api.ts`: add `resolveCreator(code)` to the Mini App API client (Bearer, contracts schema parsing; 404 → `CreatorNotFound`, 403 `FORBIDDEN_ROLE` → `RoleMismatch`, other errors reuse the existing `ApiError`/`NetworkError`/session-lost handling).
- `src/creator-link/CreatorLinkPage.tsx`, route `/creators/:publicCode` inside `RequireSession` (neither shell: this is a deep-link landing; revisit when the profile story lands). Behaviour:
  - USER, valid code → neutral stub: the creator's display name and avatar (initials fallback) with an "Profil creator belum dibangun" note (uses `NotImplemented`); no subscribe/request actions.
  - USER, not found (unknown / malformed / blocked / unavailable) → **`StatesProfile` "Creator tidak tersedia"** built 1:1: heading, "Profil ini sedang tidak bisa dibuka atau sudah tidak aktif.", button **"Kembali ke Jelajahi"** → `/explore` (buttons never wrap).
  - CREATOR (resolved from the live `/me` role, with the server 403 as the final authority) → short explanation + button to `/inbox`. **Design gap:** neutral placeholder using shared components, copy placeholder ("Link ini untuk pelanggan. Kamu masuk sebagai creator." / "Ke Inbox"), reported in the summary — not presented as a final screen.
  - network error → the existing "Belum bisa masuk" panel with "Coba Lagi" retry; 401 re-exchange handled by the existing client.
- Landing without a code keeps working: `/` → `landingPathForRole` (USER `/chats`, CREATOR `/inbox`) unchanged. A direct link keeps its path through `login-required` / `connecting` / error → retry (the provider already wraps the router; assert it).
- The code is never stored in `localStorage`/`sessionStorage`.
- Visual harness: capture "Creator tidak tersedia" against the `StatesProfile` board region at 390 wide; view the side-by-side sheet.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| MODIFY | `apps/miniapp/src/auth/api-client.ts` (+ spec) | `resolveCreator` |
| CREATE | `apps/miniapp/src/creator-link/CreatorLinkPage.tsx`, `creator-link.module.css` (+ spec) | route + states |
| MODIFY | `apps/miniapp/src/app/routes.tsx`, `router.spec.tsx` | route |
| MODIFY | `packages/ui` icons only if the board's icon is missing | copied from the board |
| MODIFY | `visual/specs/visual.spec.ts` | new capture |
| CREATE | `apps/miniapp/test/fake-miniapp-api.ts` additions | `resolveCreator` double |

**Testing:**
- Signed-out deep link: `login-required` button → login → the page for that code (not `/chats`); returning launch auto-connects to the same path; network error → retry keeps the path.
- USER + valid → stub with the name; USER + unknown/blocked → the "Creator tidak tersedia" screen and "Kembali ke Jelajahi" navigates to `/explore`; CREATOR → explanation and "Ke Inbox" → `/inbox`, no stub rendered; the creator page makes no request when signed out.
- Storage contains only `cc_tg_seen`; the heading/copy matches the board; Playwright sheet reviewed by eye.

---

### TASK-042: End-to-end verification, docs, and map

- Integration test (real listening server + HTTP): signed webhook update → reply button URL → open that path with a dev-signed login → `GET /v1/creators/by-code/<seed code>` → 200; then the same with a wrong secret (401), an unknown code (404), a CREATOR session (403).
- Wiring check with the built API and Mini App dev server using the seed creator and `pnpm telegram:initdata`; show the webhook's reply to a hand-built update.
- Verify no token/secret in any logs, `dist` of the Mini App contains no secrets, and `grep` for `localStorage|sessionStorage` in `apps/miniapp/src` still shows only `cc_tg_seen`.
- Update `codebase-map.md` (endpoint rows, entity `Creator`, Mini App route, integration status, inventory, backlog row), `backend.md` ("Built in US-005": webhook secret check, `botInfo`, webhook reply, uniform 404, local role check → US-006), `frontend.md` (deep-link-by-path rule), `tech-stack.md` (grammY 1.46.0 pinned, decisions: destination transport, `public_code` format, webhook reply, bot copy placeholder), `CLAUDE.md` current state, `README.md`.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm visual`.

**Files:**
| Action | File Path | Purpose |
|--------|-----------|---------|
| CREATE | `apps/api/test/creator-link.e2e.int.spec.ts` | real-HTTP flow |
| MODIFY | `.agile/guidelines/*.md`, `CLAUDE.md`, `README.md` | docs and map |

**Testing:**
- As listed; report honestly that real Telegram (bot message rendering, menu button, in-WebView open) is untested here, and that the CREATOR explanation screen is a placeholder for a design gap.

---
