# QA Report: TASK-223 — Gallery helper, upload purposes, orphan cleanup

**Result:** PASS (US-038, 2026-11-21)

## Built
`addToGallery` extracted from `markProcessed` (the one place that numbers the gallery); `init` accepts BROADCAST / WELCOME; `cleanup` removes unused chat / broadcast / welcome uploads after a day and never one that a message, a broadcast or a gallery item uses (references re-checked in a fresh statement after the row lock).

## Verified
- `media-upload.service.int.spec.ts`: 87 media tests pass, including 6 new cases (BROADCAST upload READY with no gallery item or number; a gallery upload still gets both; unused uploads cleaned with their objects; a recent one kept; referenced ones never removed; gallery uploads never cleaned).

## Notes
- Fixed a time bomb in the existing cleanup test (it compared a fixed 2026-11-18 clock with wall-clock database timestamps and failed from 2026-11-19). It now puts its rows on the test clock.
- `creator_welcome_messages` is added to the reference check by US-040 TASK-241.
