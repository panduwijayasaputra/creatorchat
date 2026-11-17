import { Prisma, type PrismaClient } from '@creatorchat/db';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';

export type ReadOutcome =
  { kind: 'ok'; lastReadSeq: number; moved: boolean } | { kind: 'not_found' };

/**
 * Moves the caller's own read cursor (US-030). The caller is the customer or the creator's user of
 * the conversation, found in the same statement that locks the conversation row, so another
 * conversation looks exactly like an unknown one and two advances never interleave. The cursor
 * only moves up and never past the newest message; reading is allowed after expiry and for a
 * blocked creator's chat (history stays readable). A real move writes a `read.updated` outbox
 * event with ids and the new seq in the same transaction; a no-op writes nothing.
 */
export class ConversationReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
  ) {}

  async advance(
    userId: string,
    as: 'customer' | 'creator',
    conversationId: string,
    throughSeq: number,
  ): Promise<ReadOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const scope =
        as === 'customer'
          ? Prisma.sql`c.customer_id = ${userId}::uuid`
          : Prisma.sql`c.creator_id IN (SELECT id FROM creators WHERE user_id = ${userId}::uuid)`;
      const rows = await tx.$queryRaw<{ last_message_seq: number }[]>`
        SELECT c.last_message_seq FROM conversations c
        WHERE c.id = ${conversationId}::uuid AND ${scope}
        FOR UPDATE OF c`;
      const conversation = rows[0];
      if (!conversation) return { kind: 'not_found' } as const;

      const current = await tx.conversationRead.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
        select: { lastReadSeq: true },
      });
      const before = current?.lastReadSeq ?? 0;
      const target = Math.min(throughSeq, conversation.last_message_seq);
      if (target <= before) return { kind: 'ok', lastReadSeq: before, moved: false } as const;

      await tx.conversationRead.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: { conversationId, userId, lastReadSeq: target },
        update: { lastReadSeq: target },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.READ_UPDATED,
        aggregateType: 'conversation',
        aggregateId: conversationId,
        payload: { conversation_id: conversationId, reader_id: userId, last_read_seq: target },
        dedupeKey: `read:${conversationId}:${userId}:${target}`,
      });
      return { kind: 'ok', lastReadSeq: target, moved: true } as const;
    });
  }
}
