-- Realtime delivery marker (US-031): the worker's publisher stamps a message / read event once its
-- socket signal was emitted. Independent of "status" (the Telegram pipeline of Phase E).
ALTER TABLE "outbox_events" ADD COLUMN "realtime_published_at" TIMESTAMPTZ(3);

-- Rows that exist now were already seen by their clients over HTTP: do not emit them.
UPDATE "outbox_events" SET "realtime_published_at" = CURRENT_TIMESTAMP
WHERE "type" IN ('message.created', 'read.updated');

CREATE INDEX "outbox_events_realtime_pending_idx" ON "outbox_events" ("created_at")
WHERE "realtime_published_at" IS NULL AND "type" IN ('message.created', 'read.updated');
