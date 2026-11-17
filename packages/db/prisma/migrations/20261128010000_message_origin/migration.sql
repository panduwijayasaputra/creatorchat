-- Message origin (US-029): who produced the message. Existing rows and every human send are MANUAL.
CREATE TYPE "MessageOrigin" AS ENUM ('MANUAL', 'AI');

ALTER TABLE "messages" ADD COLUMN "origin" "MessageOrigin" NOT NULL DEFAULT 'MANUAL';
