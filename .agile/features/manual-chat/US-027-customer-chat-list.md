# US-027: Customer chat list

**Status:** ready_for_uat
**Priority:** high
**Feature:** manual-chat
**Phase:** C
**Roles:** USER
**Brief refs:** §4 (Chat is the USER landing tab), §7 (unread, timestamps), §10
**Design refs:** `Chats`, `StatesChats`

## Description

As a USER, I want a list of my conversations with the latest message and unread count, so that I can see who replied and jump back in.

## Acceptance Criteria

- [ ] `/chats` matches `Chats`: one row per conversation (creator avatar, name, last message preview, time — today as `09.14`, older as `6 Nov` in my zone — and an unread badge), newest activity first, server-paginated. A conversation whose access ended shows "Akses telah berakhir" instead of the unread badge.
- [ ] The "Cari creator lain · Lihat profil dan minta akses uji coba." card links to Jelajahi. The bottom-nav Chat badge shows my total unread count.
- [ ] States from `StatesChats`: loading skeleton; empty "Belum ada percakapan … Jelajahi Creator"; error "Chat gagal dimuat … Coba Lagi" that retries.
- [ ] Only my conversations are returned (USER only; CREATOR → 403). Conversations with blocked creators stay listed (history is kept) but cannot be sent to.
- [ ] Screenshots at 390 px match `Chats` and each `StatesChats` panel.

## Tasks

### TASK-161: Chat list contracts
**Status:** done

### TASK-162: Customer read cursors: seed and constraint tests (no migration)
**Status:** done

### TASK-163: `ChatListService`, `conversation_id` on profile and Langganan
**Status:** done

### TASK-164: API endpoints and Mini App client
**Status:** done

### TASK-165: Mini App chat list (`Chats`, `StatesChats`)
**Status:** done

### TASK-166: Bottom-nav unread badge and the links into the chat
**Status:** done
