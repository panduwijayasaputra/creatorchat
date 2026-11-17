-- The audit entry written in the same transaction as an access event, so the admin can open the log
-- from "Riwayat akses" (US-021). A plain column: `audit_logs` is polymorphic and append-only, and the
-- events table is append-only too, so the id is written together with the event. Older events keep NULL.
ALTER TABLE "subscription_events" ADD COLUMN "audit_log_id" UUID;
