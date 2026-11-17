-- Creator media and gallery (US-032). A MediaAsset is one uploaded object; a GalleryItem is the
-- creator's gallery membership of a READY asset (separate relation, so later attachments can
-- reference the same asset without copying it).
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');
CREATE TYPE "MediaState" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "MediaPurpose" AS ENUM ('GALLERY');

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "client_upload_id" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "state" "MediaState" NOT NULL DEFAULT 'PENDING',
    "object_key" TEXT NOT NULL,
    "declared_type" TEXT NOT NULL,
    "declared_bytes" BIGINT NOT NULL,
    "mime" TEXT,
    "size_bytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "thumb_key" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_declared_bytes_positive" CHECK ("declared_bytes" > 0),
    CONSTRAINT "media_assets_ready_has_file" CHECK (
        "state" <> 'READY' OR ("mime" IS NOT NULL AND "size_bytes" IS NOT NULL AND "thumb_key" IS NOT NULL)
    ),
    CONSTRAINT "media_assets_ready_video_has_duration" CHECK (
        "state" <> 'READY' OR "kind" <> 'VIDEO' OR "duration_ms" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");
CREATE UNIQUE INDEX "media_assets_thumb_key_key" ON "media_assets"("thumb_key");
CREATE UNIQUE INDEX "media_assets_creator_id_client_upload_id_key" ON "media_assets"("creator_id", "client_upload_id");
CREATE INDEX "media_assets_state_created_at_idx" ON "media_assets"("state", "created_at");

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "gallery_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gallery_items_creator_id_asset_id_key" ON "gallery_items"("creator_id", "asset_id");
CREATE UNIQUE INDEX "gallery_items_creator_id_seq_key" ON "gallery_items"("creator_id", "seq");

ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Media number: the next "Media #N" of a creator, taken under the creator row lock.
ALTER TABLE "creators" ADD COLUMN "last_gallery_seq" INTEGER NOT NULL DEFAULT 0;
