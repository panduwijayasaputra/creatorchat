-- The access event an approval produced (US-024): set when an admin grants or extends access and the
-- customer's pending request for that creator is closed in the same transaction. Rejected and pending
-- requests have no event. A plain nullable FK; the events table is append-only, so RESTRICT is only a guard.
ALTER TABLE "access_requests" ADD COLUMN "subscription_event_id" UUID;

ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_subscription_event_id_fkey" FOREIGN KEY ("subscription_event_id") REFERENCES "subscription_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "access_requests_subscription_event_id_idx" ON "access_requests"("subscription_event_id");

ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_event_chk" CHECK ("subscription_event_id" IS NULL OR "status" = 'APPROVED');
