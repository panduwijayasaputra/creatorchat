-- User (Mini App) sessions carry no refresh token: the app re-exchanges Telegram initData (US-004).
-- They record the user's session_version at issue time so a block or role change can invalidate them.
ALTER TABLE "sessions" ALTER COLUMN "refresh_token_hash" DROP NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "session_version" INTEGER;

-- Admin sessions always have a refresh token; user sessions always record a session_version.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_credentials_chk" CHECK (
  (admin_id IS NULL OR refresh_token_hash IS NOT NULL)
  AND (user_id IS NULL OR session_version IS NOT NULL)
);
