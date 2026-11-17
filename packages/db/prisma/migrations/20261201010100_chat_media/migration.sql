-- Chat media (US-036), part 2. A MEDIA message may have no text; chat-only uploads belong to exactly
-- one conversation; a message_attachments row ties one message to one asset.
ALTER TABLE "messages" ALTER COLUMN "body" DROP NOT NULL;

ALTER TABLE "messages" DROP CONSTRAINT "messages_body_len_chk";
-- Same limit as the API (CHAT_TEXT_MAX); a text may not be empty, a media message may have none.
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_len_chk"
    CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 2000);
ALTER TABLE "messages" ADD CONSTRAINT "messages_text_has_body_chk"
    CHECK ("type" = 'MEDIA' OR "body" IS NOT NULL);

ALTER TABLE "media_assets" ADD COLUMN "conversation_id" UUID;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_chat_has_conversation_chk"
    CHECK (("purpose" = 'CHAT') = ("conversation_id" IS NOT NULL));

CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_attachments_message_id_position_key" ON "message_attachments"("message_id", "position");
CREATE INDEX "message_attachments_asset_id_idx" ON "message_attachments"("asset_id");

ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
