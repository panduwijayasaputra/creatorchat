# Feature: admin-auth

**Phase:** A — Foundation
**Roles:** Admin
**Brief refs:** §3 (Admin), §11 (Login, Dialog/confirmation), §15
**Design refs:** `AdmLogin`, `AdmLoginStates`, `AdmLogoutDlg`

## Overview

Admins live in a separate identity table and log in to the separate web dashboard with username and password. There is no public registration; the first admin is created through a safe CLI/seed. Sessions use a short-lived access token plus a rotating, revocable refresh token in Secure/HttpOnly cookies. Admin authentication is fully independent of Telegram authentication.

Account settings (change password, active sessions table, revoke) are designed (`AdmSetAccount*`, `AdmSessDetail*`) but belong to Phase G.

## Stories

| ID | Title | Priority |
|----|-------|----------|
| US-003 | Admin login, session, and logout | high |
