-- Broadcast (US-038): one photo or video, with an optional text, for every active subscriber of a
-- creator. The worker (US-039) snapshots the recipients and writes one message per conversation.
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    -- Made by the client; (creator, client_broadcast_id) makes a retried send return the same broadcast.
    "client_broadcast_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "body" TEXT,
    "save_to_gallery" BOOLEAN NOT NULL DEFAULT false,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'QUEUED',
    "snapshot_at" TIMESTAMPTZ(3),
    "recipient_count" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id"),
    -- Same limit as a chat message (CHAT_TEXT_MAX); the text is optional, never empty.
    CONSTRAINT "broadcasts_body_len_chk" CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 2000)
);

CREATE UNIQUE INDEX "broadcasts_creator_id_client_broadcast_id_key"
    ON "broadcasts"("creator_id", "client_broadcast_id");
CREATE INDEX "broadcasts_status_created_at_idx" ON "broadcasts"("status", "created_at");
CREATE INDEX "broadcasts_asset_id_idx" ON "broadcasts"("asset_id");

ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One row per customer in the snapshot. `id` is the deterministic client_message_id of the message
-- written for this recipient.
CREATE TABLE "broadcast_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broadcast_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "message_id" UUID,
    -- A short code, never free text.
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("broadcast_id", "customer_id"),
    CONSTRAINT "broadcast_recipients_reason_chk" CHECK ("reason" IS NULL OR "reason" ~ '^[a-z0-9_]{1,32}$'),
    CONSTRAINT "broadcast_recipients_delivered_has_message_chk"
        CHECK (("status" = 'DELIVERED') = ("message_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "broadcast_recipients_id_key" ON "broadcast_recipients"("id");
CREATE UNIQUE INDEX "broadcast_recipients_message_id_key" ON "broadcast_recipients"("message_id");
CREATE INDEX "broadcast_recipients_broadcast_id_status_idx" ON "broadcast_recipients"("broadcast_id", "status");

ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey"
    FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A message written for a broadcast; at most one per broadcast in a conversation.
ALTER TABLE "messages" ADD COLUMN "broadcast_id" UUID;
ALTER TABLE "messages" ADD CONSTRAINT "messages_broadcast_id_fkey"
    FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "messages_broadcast_conversation_uq" ON "messages"("broadcast_id", "conversation_id")
    WHERE "broadcast_id" IS NOT NULL;
