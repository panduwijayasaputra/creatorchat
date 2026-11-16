-- The current Telegram photo, kept apart from the app photo so "Pakai Foto Telegram" can reset to it (US-007).
-- Refreshed on every login. Until now avatar_url was only ever the Telegram photo, so it seeds the new column.
-- No length CHECKs: profile limits (name 1-40, bio 160) are validated in the API; existing names may be longer.
ALTER TABLE "users" ADD COLUMN "telegram_avatar_url" TEXT;
UPDATE "users" SET "telegram_avatar_url" = "avatar_url";
