-- Refresh-token rotation with reuse detection (US-003).
-- The hash of the token that was just replaced is kept so that presenting it again is detectable.
ALTER TABLE "sessions" ADD COLUMN "previous_refresh_token_hash" TEXT;
ALTER TABLE "sessions" ADD COLUMN "rotated_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "sessions_previous_refresh_token_hash_key" ON "sessions"("previous_refresh_token_hash");
