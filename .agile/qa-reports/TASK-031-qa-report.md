# QA Report: TASK-031 — Mini App: Telegram wrapper, auth client, AuthProvider, route guard, role landing

**Result:** PASS

## Checked
- `telegram/webapp.ts`: typed minimal `window.Telegram.WebApp`; `getInitData()` is `null` outside Telegram (missing or empty); `signalReady()` calls `ready()` + `expand()` and is a no-op outside; `botUrl()` accepts only a valid bot username (placeholder `<bot_username>`, spaces, `javascript:` all give `null`).
- `telegram/dev-init-data.ts`: `?tgdev=` fakes the WebApp only when no real initData exists; imported solely behind `import.meta.env.DEV` in `main.tsx` (the production-bundle check is done in TASK-034).
- `auth/api-client.ts`: token only in the closure (`credentials: 'omit'`, Bearer header); login posts only `init_data`; responses parsed with the contract schemas; `NetworkError` vs `ApiError`; a 401 triggers one single-flight re-exchange of initData and one retry; a refused re-exchange reports `expired` / `blocked` / `unavailable`; nothing written to storage.
- `AuthProvider`: states `connecting | login-required | outside-telegram | authenticated | error(network|expired|blocked|unavailable)`; role and status come from `/me` (a test makes the login body say USER while `/me` says CREATOR → lands on `/inbox`); a returning device (cosmetic `cc_tg_seen`) connects on its own; session loss later returns to an error state; stale async results are ignored.
- `RequireSession` / `LandingRedirect` and `createMiniappRoutes({ api, … })`: every route except the dev-only `/__preview` needs a signed-in account; `/` lands USER on `/chats` and CREATOR on `/inbox`. Wrong-role URLs still render their shell until US-006 (documented in the code and plan).
- `index.html` loads the official `telegram-web-app.js`; `.env.example` already documents the two public `VITE_*` values.
- The existing router spec was adapted (async, fake API) and still covers shells, placeholders, unread badge, health indicator and tab navigation.

## Results
- miniapp: 60 tests pass (api-client 8 incl. concurrency, wrapper/dev 6, flow 12, router 14+, shells/preview unchanged); typecheck and lint pass.

## Notes
- `screens/AuthGate.tsx` renders plain controls on purpose; TASK-032 replaces it with the AuthLogin / AuthOutside / AuthStates boards.
