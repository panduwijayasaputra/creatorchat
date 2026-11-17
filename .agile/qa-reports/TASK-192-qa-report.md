# QA Report: TASK-192 — Worker — media processing queue and cleanup loop

**Result:** PASS (US-032, 2026-11-18)

## Built
Worker `media` pipeline: ffmpeg / ffprobe wrappers (argument arrays, 120 s timeout), `MediaProcessor`, `MediaEventHandler` (3 attempts, then FAILED / UNREADABLE), `startMedia` (outbox loop, queue, consumer, cleanup every 10 min), wired in `main.ts`. `createNotificationQueue/Worker` take a queue name.

## Verified
11 integration tests with generated fixtures: JPEG with GPS EXIF becomes READY with no EXIF, a 480 px thumbnail and gallery item 1; MP4 with location tags is remuxed without them, duration ≈ 2 s, poster thumbnail; a too long video is FAILED TOO_LONG with objects deleted; a corrupt JPEG and a video with no streams are UNREADABLE; a second run adds no second item; the handler settles the event, retries an unexpected error with a delay and gives up as FAILED; without ffprobe or storage settings one warning and the event stays PENDING; the whole pipeline (outbox, Redis, BullMQ, processor) reaches READY.

## Notes
Photos lose ICC profile and animation (first frame only) by design. HEVC videos are copied as is (no transcoding). `pnpm-workspace.yaml` records `msgpackr-extract: false`.
