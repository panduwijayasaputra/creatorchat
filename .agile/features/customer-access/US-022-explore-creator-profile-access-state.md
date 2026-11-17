# US-022: Explore and creator profile by access state

**Status:** ready_for_uat
**Priority:** high
**Feature:** customer-access
**Phase:** C
**Roles:** USER, System
**Brief refs:** §4 (deep link chooses a target only; invalid link → profile unavailable), §6 (capability table), §8A (no gallery media for non-subscribers), §10
**Design refs:** `Explore`, `CreatorGuest`, `CreatorPending`, `CreatorActive`, `CreatorExpired`, `StatesProfile`

## Description

As a USER, I want to browse creators and open a creator's profile that tells me where my access stands, so that I know whether I can chat and what to do next.

## Acceptance Criteria

- [x] `/explore` matches `Explore`: a card per ACTIVE creator (avatar, name, bio excerpt, "Profil" button) with my access chip per creator — Aktif / Menunggu / Berakhir (icon + label), no chip when I have no relation. Blocked creators and creator applications never appear. List is server-paginated.
- [x] `/creators/:publicCode` (also the bio deep-link target from US-005) shows the real profile with exactly one state from the server: **guest** (`CreatorGuest`: "Minta Akses Uji Coba"), **pending** (`CreatorPending`: "Permintaan akses terkirim", Dikirim date, "Menunggu Persetujuan"), **active** (`CreatorActive`: "Akses aktif hingga …", "Berakhir pukul 23.59 WIB", "Buka Chat") or **expired/revoked** (`CreatorExpired`: "Akses telah berakhir", "Minta Perpanjangan Akses", "Lihat Riwayat Chat"). Dates use the account's display zone.
- [x] For every non-active state the gallery section is only the "Galeri tersedia untuk subscriber aktif" panel with that state's copy — **no tiles, counts, durations or media URLs** (Resolved Conflict #1); the API response for a non-subscriber contains no media data. For the active state the gallery area is a placeholder until Phase D.
- [x] A blocked or unknown creator code shows `StatesProfile` "Creator tidak tersedia" with the way to Jelajahi. A CREATOR opening this route still gets the US-005 explanation, and the Explore/profile endpoints answer 403 `FORBIDDEN_ROLE` for CREATOR tokens.
- [x] Access state is computed on the server with the entitlement rule at request time (e.g. an `ends_at` that passed a minute ago shows expired). Screenshots at 390 px match the boards (minus the omitted tile grid and the category/city gap).

## Tasks

### TASK-127: Explore and profile access contracts
**Status:** done

### TASK-128: Migration: `access_requests` and seed
**Status:** done

### TASK-129: `accessStateOf` and `CreatorAccessService`
**Status:** done

### TASK-130: API endpoints and Mini App client
**Status:** done

### TASK-131: Explore page
**Status:** done

### TASK-132: Creator profile by access state
**Status:** done
