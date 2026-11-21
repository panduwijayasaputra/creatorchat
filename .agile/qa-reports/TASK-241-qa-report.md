# QA Report: TASK-241 — Contracts and WelcomeMessageService

**Result:** PASS (US-040, 2026-11-21)

## Built
Contracts `welcome-message.ts` (strict whole-state body, exact answer, no storage key) and `welcome_enabled` on the creator settings; `WelcomeMessageService` (`get`, `save`); `creator_welcome_messages` added to the unused-upload cleanup reference check; `CreatorSettingsService` returns `welcomeEnabled`.

## Verified
- Contracts: 381 tests (new spec; settings spec gained `welcome_enabled`).
- `welcome-message.service.int.spec.ts` (13 cases, real PostgreSQL): off and empty before the first save and reading writes nothing; `not_found` for a customer, unknown user, blocked creator and blocked account; text-only save; a gallery file (same asset, GALLERY, signed thumbnail, nothing copied); an upload made for the welcome message (UPLOAD, never in the gallery); replace, remove and repeat; a draft text while off, and an empty one stored as nothing; the switch on without text or over 2000 characters refused and nothing written; another creator's file, BROADCAST, un-galleried gallery file, unknown and malformed ids all `media_not_found`; PENDING → `media_not_ready`, FAILED → `media_not_found`; one creator's message never touches another's; two saves at once end in one row; the settings flag follows the switch.
- `media-upload.service.int.spec.ts` (+1): an upload the welcome message uses is never cleaned up, an unused one is.
