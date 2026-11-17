-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('GRANT', 'EXTEND', 'REVOKE');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('AI', 'MANUAL');

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "admin_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_ends_at" TIMESTAMPTZ(3),
    "new_ends_at" TIMESTAMPTZ(3),
    "starts_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'MANUAL',
    "response_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_created_at_id_idx" ON "subscription_events"("subscription_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "conversations_creator_id_idx" ON "conversations"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_customer_id_creator_id_key" ON "conversations"("customer_id", "creator_id");

-- CreateIndex
CREATE INDEX "subscriptions_creator_id_ends_at_idx" ON "subscriptions"("creator_id", "ends_at");

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The reason is required and bounded (the API enforces the same limits).
ALTER TABLE "subscription_events"
  ADD CONSTRAINT "subscription_events_reason_chk" CHECK (char_length("reason") BETWEEN 1 AND 300);

-- The access history is append-only: reject UPDATE and DELETE at the database level.
CREATE FUNCTION "subscription_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'subscription_events is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "subscription_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "subscription_events"
  FOR EACH ROW EXECUTE FUNCTION "subscription_events_append_only"();
