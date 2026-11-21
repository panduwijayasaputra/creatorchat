import type { PrismaClient } from '@creatorchat/db';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface CreatorMessageInput {
  conversationId: string;
  creatorUserId: string;
  /** The (conversation, sender, client_message_id) pair makes a repeated write find the same row. */
  clientMessageId: string;
  /** Null only for a media message without text. */
  body: string | null;
  /** The file of a media message; one attachment (position 0). */
  assetId: string | null;
  /** Set for a message written for a broadcast (US-039): at most one per broadcast and conversation. */
  broadcastId?: string | undefined;
  now: Date;
}

/**
 * The write half of a creator message, shared by the manual send, the broadcast fan-out and the
 * welcome message: the next sequence number, the message and its attachment, and the
 * `message.created` outbox event. The caller holds the conversation row lock and has already checked
 * access, ownership of the asset and idempotency; this never touches `mode` or `response_version`,
 * so a broadcast or a welcome message cannot take over a conversation from the AI.
 */
export async function writeCreatorMessage(
  tx: Tx,
  outbox: OutboxService,
  input: CreatorMessageInput,
) {
  const [counter] = await tx.$queryRaw<{ seq: number }[]>`
    UPDATE conversations SET last_message_seq = last_message_seq + 1, last_message_at = ${input.now}, updated_at = ${input.now}
    WHERE id = ${input.conversationId}::uuid RETURNING last_message_seq AS seq`;
  const row = await tx.message.create({
    data: {
      conversationId: input.conversationId,
      senderUserId: input.creatorUserId,
      type: input.assetId === null ? 'TEXT' : 'MEDIA',
      body: input.body,
      origin: 'MANUAL',
      clientMessageId: input.clientMessageId,
      seq: counter!.seq,
      createdAt: input.now,
      ...(input.broadcastId ? { broadcastId: input.broadcastId } : {}),
      ...(input.assetId !== null
        ? { attachments: { create: { assetId: input.assetId, position: 0 } } }
        : {}),
    },
  });
  await outbox.add(tx, {
    type: OutboxEventType.MESSAGE_CREATED,
    aggregateType: 'message',
    aggregateId: row.id,
    payload: {
      message_id: row.id,
      conversation_id: input.conversationId,
      sender_id: input.creatorUserId,
    },
    dedupeKey: `message:${row.id}:created`,
  });
  return row;
}
