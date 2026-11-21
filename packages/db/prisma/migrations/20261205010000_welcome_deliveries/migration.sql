-- Welcome message delivery (US-041): at most one per creator and customer, ever. The row is
-- inserted first (a conflict means "already handled"); its `id` is the client_message_id of the
-- message that carries the welcome text.
CREATE TABLE "welcome_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "welcome_deliveries_pkey" PRIMARY KEY ("creator_id", "customer_id")
);

CREATE UNIQUE INDEX "welcome_deliveries_id_key" ON "welcome_deliveries"("id");
CREATE UNIQUE INDEX "welcome_deliveries_message_id_key" ON "welcome_deliveries"("message_id");

ALTER TABLE "welcome_deliveries" ADD CONSTRAINT "welcome_deliveries_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "welcome_deliveries" ADD CONSTRAINT "welcome_deliveries_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "welcome_deliveries" ADD CONSTRAINT "welcome_deliveries_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
