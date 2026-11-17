-- Chat messages (US-026). Text only; media joins in Phase D.
CREATE TYPE "MessageType" AS ENUM ('TEXT');

-- Last seq handed out in the conversation; incremented under the conversation row lock.
ALTER TABLE "conversations" ADD COLUMN "last_message_seq" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "client_message_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "messages_conversation_id_seq_key" ON "messages"("conversation_id", "seq");
CREATE UNIQUE INDEX "messages_conversation_id_sender_user_id_client_message_id_key" ON "messages"("conversation_id", "sender_user_id", "client_message_id");

ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same limit as the API (CHAT_TEXT_MAX): 1..2000 characters.
ALTER TABLE "messages" ADD CONSTRAINT "messages_body_len_chk" CHECK (char_length("body") BETWEEN 1 AND 2000);
