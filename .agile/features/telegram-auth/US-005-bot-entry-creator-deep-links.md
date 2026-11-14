# US-005: Bot entry and creator deep links

**Status:** backlog
**Priority:** high
**Feature:** telegram-auth
**Phase:** A
**Roles:** USER, CREATOR, System (bot)
**Brief refs:** §4 (entry flow, link pattern, menu behavior), §1 (bot role), §14 (webhook secret, quick handler)
**Design refs:** `AuthMain` ("Tujuan setelah login"), `CrSettings` ("Link bot untuk bio" — sample `t.me/CreatorChatBot?start=salsa`). "Profil tidak tersedia" and "creator opens another creator's link" screens: not designed — gap

## Description

As a person who taps a creator's Instagram bio link, I want the bot to open the Mini App straight to that creator after I log in, so that I reach the creator I came for without searching.

## Acceptance Criteria

- [ ] The bot runs as a webhook (grammY). Requests without the correct webhook secret are rejected, the handler responds quickly and does no slow work inline, and the bot token never appears in logs.
- [ ] `/start c_<public_code>` (exact format confirmed in planning) replies with a button that opens the Mini App carrying the destination. `/start` without a code and the bot menu button open the Mini App without a destination.
- [ ] The destination survives login: after US-004 login a USER with a valid creator code lands on that creator's profile route; without a code USER lands on Chat and CREATOR on Inbox. The code only chooses where to go — it never grants subscription, role, or any data access, and is resolved on the server after login.
- [ ] An unknown, malformed, or blocked creator code doesn't crash or leak whether the creator exists beyond "not available": the user is routed to a "profil tidak tersedia" state with a way to Jelajahi. (Final visual is a design gap — a neutral placeholder until designed.)
- [ ] A CREATOR opening another creator's link is **not** given customer access or the USER role; they see a short explanation and return to their Inbox (visual is a design gap).
- [ ] A `Creator` record with a unique `public_code` exists so links can be resolved (minimal fields only; the creator profile itself is built in a later phase). With no bot token configured, local dev still runs and the webhook is reported as unconfigured.
