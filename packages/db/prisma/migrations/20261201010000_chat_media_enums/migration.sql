-- Chat media (US-036), part 1: the new enum values. They are used by the next migration, which must
-- run after this transaction has committed.
ALTER TYPE "MessageType" ADD VALUE 'MEDIA';
ALTER TYPE "MediaPurpose" ADD VALUE 'CHAT';
