-- Creator inbox (US-028): last activity time and per-participant read cursors.
ALTER TABLE "conversations" ADD COLUMN "last_message_at" TIMESTAMPTZ(3);

-- Existing chats (seed, dev data) keep their order.
UPDATE "conversations" c
SET "last_message_at" = (SELECT max(m."created_at") FROM "messages" m WHERE m."conversation_id" = c."id");

-- The inbox list: a creator's non-empty conversations, newest activity first.
CREATE INDEX "conversations_creator_last_message_idx"
  ON "conversations" ("creator_id", "last_message_at" DESC, "id" DESC)
  WHERE "last_message_at" IS NOT NULL;

CREATE TABLE "conversation_reads" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_reads_pkey" PRIMARY KEY ("conversation_id", "user_id")
);

ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_seq_chk" CHECK ("last_read_seq" >= 0);
