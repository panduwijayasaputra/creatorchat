# US-028: Creator inbox

**Status:** ready_for_uat
**Priority:** high
**Feature:** manual-chat
**Phase:** C
**Roles:** CREATOR
**Brief refs:** §4 (Inbox is the CREATOR landing tab), §7, §10 (Inbox and filters per design)
**Design refs:** `CrInbox`, `CrStatesInbox`

## Description

As a CREATOR, I want an inbox of my customer conversations with unread counts, so that I can see who is waiting for a reply.

## Acceptance Criteria

- [ ] `/inbox` matches `CrInbox`: rows with customer initials/avatar, name, last message preview, time, unread badge, and an "Akses berakhir" chip (icon + label) when that customer's access is no longer active; newest activity first, server-paginated.
- [ ] Filter chips **Semua** and **Belum Dibaca n** work against the server. The "Manual" and "Perlu Perhatian" chips and the "AI Aktif" / "Balasan AI gagal" row chips are Phase F and are not shown yet.
- [ ] States from `CrStatesInbox`: loading; empty "Belum ada percakapan … Salin Link Profil" (copies the server-built bio link from US-008); error "Inbox gagal dimuat … Coba Lagi"; offline "Koneksi terputus · Menyambungkan ulang…" (driven by US-031).
- [ ] Only conversations where I am the creator are returned (CREATOR only; USER → 403). A customer's Telegram ID is never shown in the inbox.
- [ ] Screenshots at 390 px match `CrInbox` (minus Phase F chips) and each `CrStatesInbox` panel.

## Tasks

### TASK-154: Inbox contracts
**Status:** done

### TASK-155: Schema, migration and send-path update
**Status:** done

### TASK-156: `CreatorInboxService` in backend-core
**Status:** done

### TASK-157: API endpoint
**Status:** done

### TASK-158: Mini App inbox data layer
**Status:** done

### TASK-159: Mini App inbox screen (`CrInbox`, `CrStatesInbox`)
**Status:** done

### TASK-160: Visual check and docs
**Status:** done
