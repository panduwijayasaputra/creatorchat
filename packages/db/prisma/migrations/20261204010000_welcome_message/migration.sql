-- Welcome message (US-040): at most one per creator, sent once to each new subscriber (US-041).
-- The text is required while it is switched on; the media is optional and is a gallery file or an
-- upload made for the welcome message (never in the gallery).
CREATE TABLE "creator_welcome_messages" (
    "creator_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT,
    "asset_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_welcome_messages_pkey" PRIMARY KEY ("creator_id"),
    -- Same limit as a chat message; the text is never empty when present.
    CONSTRAINT "creator_welcome_messages_body_len_chk"
        CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 2000),
    CONSTRAINT "creator_welcome_messages_enabled_has_body_chk"
        CHECK ("enabled" = false OR "body" IS NOT NULL)
);

CREATE INDEX "creator_welcome_messages_asset_id_idx" ON "creator_welcome_messages"("asset_id");

ALTER TABLE "creator_welcome_messages" ADD CONSTRAINT "creator_welcome_messages_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creator_welcome_messages" ADD CONSTRAINT "creator_welcome_messages_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
