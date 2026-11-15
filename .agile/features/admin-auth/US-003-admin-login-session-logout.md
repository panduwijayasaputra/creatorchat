# US-003: Admin login, session, and logout

**Status:** ready_for_uat
**Priority:** high
**Feature:** admin-auth
**Phase:** A
**Roles:** Admin
**Brief refs:** §3 (Admin), §11 (Login, Dialog), §15, §17 (admin auth independent)
**Design refs:** `AdmLogin`, `AdmLoginStates` (Memeriksa…, validasi, kredensial salah, gagal terhubung), `AdmLogoutDlg`

## Description

As an admin, I want to log in to the dashboard with my username and password and log out safely, so that only platform staff can manage creators, users, and access.

## Acceptance Criteria

- [x] The first admin is created with a CLI/seed command that takes a supplied password or generates one and shows it once. No default password exists in the repo, passwords are hashed with Argon2id, and there is no public registration route or UI ("Akun admin dibuat oleh tim platform. Tidak ada pendaftaran admin publik.").
- [x] `/login` matches `AdmLogin`/`AdmLoginStates`: "Tampilkan" toggles password visibility; empty fields show "Username wajib diisi." / "Password wajib diisi." inline; while submitting the button shows "Memeriksa…" and can't be clicked twice. On success the admin lands on `/` inside the admin shell.
- [x] Wrong credentials show "Username atau password salah" with the attempt counter ("Percobaan: N dari 5"), without revealing whether the username exists. After 5 failures the login is locked for 15 minutes (enforced server-side, not just in the UI). A network failure shows "Tidak bisa terhubung ke server" with "Coba Lagi", and the typed username and password are kept.
- [x] The session uses a short-lived access token and a rotating refresh token in Secure/HttpOnly cookies with CSRF protection and an explicit CORS allowlist. No token is stored in `localStorage`/`sessionStorage`. Reusing a rotated refresh token is rejected. A blocked/disabled admin account cannot log in or refresh.
- [x] "Logout" opens the `AdmLogoutDlg` confirmation ("Keluar dari dashboard?", "Batal", "Logout"). Confirming revokes the session server-side, clears the cookies, and returns to `/login`. Later requests with the old tokens get 401.
- [x] Authorization separation: every `/v1/admin/*` endpoint rejects requests without a valid admin session, a Telegram user session can never reach `/v1/admin/*`, and an admin token cannot call user endpoints. Login, logout, and lockout events are written to `AuditLog` without passwords or tokens.

## Tasks

### TASK-020: Admin auth contracts and error codes
**Status:** done

### TASK-021: Session rotation migration, shared password helpers, admin CLI
**Status:** done

### TASK-022: Admin auth domain service (backend-core)
**Status:** done

### TASK-023: `/v1/admin/auth` API (cookies, CSRF, guard, rate limit)
**Status:** done

### TASK-024: Admin app auth client, AuthProvider, route guard, logout wiring
**Status:** done

### TASK-025: `/login` page (AdmLogin + AdmLoginStates) and visual check
**Status:** done

### TASK-026: End-to-end verification, docs, and map
**Status:** done
