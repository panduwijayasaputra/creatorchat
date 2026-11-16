# QA Report: TASK-051 — Mini App API client, profile state, shared Avatar and Switch

**Result: PASS** (2026-11-16)

- `createMiniappApi().updateProfile()` PATCHes `/v1/me/profile` with the Bearer token (memory only), parses the response with `UpdateProfileResponseSchema`; the single-flight 401 re-exchange now replays the same body. `NetworkError` / `ApiError` surface unchanged. 3 new client tests.
- `AuthProvider.updateProfile()` replaces the in-memory user on success and rethrows on failure without touching it (2 tests); no second cache, no storage.
- `Avatar` (illustration fallback when `src` is missing or fails to load; retries when `src` changes; `referrerPolicy="no-referrer"`) and `Switch` (`role="switch"`, `aria-checked`, disabled not toggleable) are presentational, in `packages/ui`, with specs and a `/__preview` section (`avatar-switch`).
- Fake API gained `updateProfile`; fixtures carry the new `bio` / `telegram_avatar_url` fields.
- `pnpm typecheck` ✔, `pnpm lint` ✔, ui 164 tests ✔, miniapp 99 tests ✔.
