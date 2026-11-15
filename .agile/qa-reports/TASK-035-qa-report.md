# QA Report: TASK-035 — Contracts — public code, creator-link resolution, error codes

**Result:** PASS

## Checked
- `packages/contracts/src/creator-link.ts` (+ spec): `PublicCodeSchema` (8 chars `a-z2-7`), `StartPayloadSchema` (wider on purpose), `creatorPath`, `creatorByCodePath`, strict `CreatorLinkResponseSchema`; `CREATOR_NOT_FOUND` and `FORBIDDEN_ROLE` added to the catalogue.
- Tests cover invalid codes (length, uppercase, digits 0/1/8/9, unicode, traversal), payload edge cases, URL-encoding of unsafe input and rejection of extra response keys (`id`, `role`, `status`).
- Note: the plan's sample code `k4m9x2qa` contains a `9`, which is not base32. The bot accepts it (start payload is wider) but the resolver treats it as malformed. All tests use valid samples such as `k4m5x2qa`.

## Not verified here
- Real Telegram behaviour (see TASK-042).
