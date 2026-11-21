-- Message notifications (US-042). No row means the defaults: notifications on, content hidden, nothing muted.
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "messages_enabled" BOOLEAN NOT NULL DEFAULT true,
    "show_content" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- A customer muted one creator: no message or broadcast notification from that creator.
CREATE TABLE "creator_mutes" (
    "user_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_mutes_pkey" PRIMARY KEY ("user_id", "creator_id")
);

-- Up to which message a participant was already told about, so a burst becomes one notification.
CREATE TABLE "notification_state" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_notified_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_state_pkey" PRIMARY KEY ("conversation_id", "user_id"),
    CONSTRAINT "notification_state_seq_chk" CHECK ("last_notified_seq" >= 0)
);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creator_mutes" ADD CONSTRAINT "creator_mutes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creator_mutes" ADD CONSTRAINT "creator_mutes_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_state" ADD CONSTRAINT "notification_state_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_state" ADD CONSTRAINT "notification_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
