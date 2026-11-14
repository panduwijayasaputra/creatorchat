# US-004: Mini App login with Telegram and role-based landing

**Status:** backlog
**Priority:** high
**Feature:** telegram-auth
**Phase:** A
**Roles:** USER, CREATOR
**Brief refs:** §3 (User, Validasi Telegram), §4 (navigation), §17 (forged/stale auth rejected; new accounts USER)
**Design refs:** `AuthMain`, `AuthLogin`, `AuthOutside`, `AuthStates` (Menghubungkan ke Telegram…, Belum bisa masuk, Sesi Telegram berakhir). "Syarat Layanan"/"Kebijakan Privasi" pages: not designed — gap

## Description

As a Telegram user, I want to enter the Mini App with my Telegram identity without filling in anything, so that I can start using the app right away and land in the right place for my role.

## Acceptance Criteria

- [ ] Inside Telegram, `AuthLogin` shows "Lanjutkan dengan Telegram". Continuing sends `initData` to the API, which validates the signature with the bot token and checks `auth_date` against the configured max age. While waiting, "Menghubungkan ke Telegram…" is shown. The demo strip on `AuthLogin` ("DEMO · bukan fitur produk") is not built.
- [ ] On first login a `User` is created by `telegram_id` with role **USER** and status ACTIVE; Telegram name and photo become the initial app profile. Later logins don't overwrite profile edits and identify the user by `telegram_id`, never by username. The API returns `telegram_id` as a string.
- [ ] After login, USER lands on **Chat** and CREATOR lands on **Inbox** (in the shells from US-002). Role comes only from the server (`/v1/me`), never from `initDataUnsafe` or the client. The session token is kept in memory (not `localStorage`) and is re-issued from `initData` when the Mini App is reopened.
- [ ] Forged, tampered, or expired `initData` is rejected (401, no user created or changed). Expired auth shows "Sesi Telegram berakhir" with "Coba Lagi"; a network failure shows "Belum bisa masuk" with "Coba Lagi". Neither raw `initData` nor the bot token appears in logs.
- [ ] Opened outside Telegram (no `initData`), the app shows `AuthOutside` with "Buka di Telegram" linking to the bot (username from config). There is no other web login.
- [ ] A user whose account is BLOCKED gets no session (see US-006 for the message). Telegram login is rate-limited.
