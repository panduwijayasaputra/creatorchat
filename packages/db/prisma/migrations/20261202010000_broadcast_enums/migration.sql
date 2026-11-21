-- Broadcast (US-038), part 1: the new enum values and types. They are used by the next migration,
-- which must run after this transaction has committed.
ALTER TYPE "MediaPurpose" ADD VALUE 'BROADCAST';
ALTER TYPE "MediaPurpose" ADD VALUE 'WELCOME';

CREATE TYPE "BroadcastStatus" AS ENUM ('QUEUED', 'FANNING_OUT', 'COMPLETED');
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'DELIVERED', 'SKIPPED', 'FAILED');
