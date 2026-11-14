# Feature: telegram-auth

**Phase:** A — Foundation
**Roles:** USER, CREATOR, System (bot)
**Brief refs:** §3 (User, Creator, Validasi Telegram), §4 (Entry flow, navigation), §15, §17
**Design refs:** `AuthMain` (rules and routing), `AuthLogin`, `AuthOutside`, `AuthStates`

## Overview

Users only log in through Telegram. The Mini App sends Telegram `initData`, the server validates it and issues an app session. Every new account starts as USER; the Telegram ID is the permanent identity. The bot is the entry point: an Instagram bio link opens the bot with a creator code, the bot offers a button that opens the Mini App, and after login the user lands on the right destination. The start parameter only selects a destination and never grants access.

Role and account status are enforced on the server for every session: blocked accounts and stale sessions (after a block or role change) lose access.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-004 | Mini App login with Telegram and role-based landing | high |
| US-005 | Bot entry and creator deep links | high |
| US-006 | Account status and role enforcement on every session | high |

## Design gaps (from `design-integration.md`)

- "Syarat Layanan" and "Kebijakan Privasi" pages linked from `AuthLogin`/`AuthOutside` are not designed (also the planned home of the AI-assistance disclosure).
- "Profil tidak tersedia" screen for an invalid creator link and the short explanation shown when a CREATOR opens another creator's link are not designed.
