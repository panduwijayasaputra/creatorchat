import type { PrismaClient } from '@creatorchat/db';
import { checkCreatorCanMessage, type RecipientRefusal } from '../chat/creator-recipient-check.js';
import { writeCreatorMessage } from '../chat/message-writer.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';

/** A recipient that keeps failing for a technical reason is given up after this many tries. */
export const RECIPIENT_MAX_ATTEMPTS = 5;

export type SkipReason = RecipientRefusal;

export interface BatchResult {
  delivered: number;
  skipped: number;
  failed: number;
  /** Recipients still PENDING (including ones another worker is delivering right now). */
  remaining: number;
}

type DeliverOutcome = 'delivered' | 'skipped' | 'failed' | 'busy' | 'missing';

/**
 * Turns one recorded broadcast into one creator message per active subscriber (US-039). Every
 * recipient is its own short transaction, so a crash or a retry can only repeat work that the
 * database already refuses to duplicate: the recipient row is the primary key (broadcast, customer),
 * the message has a unique index (broadcast, conversation), and the recipient's own id is the
 * message's `client_message_id`. State lives in PostgreSQL only; nothing here trusts a queue.
 */
export class BroadcastFanOutService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Snapshots the customers with active access right now (one statement) and starts the fan-out.
   * Only a QUEUED broadcast is started: a second call finds it started and changes nothing, so the
   * snapshot is never rebuilt and later subscribers never join.
   */
  async start(broadcastId: string): Promise<'started' | 'already_started' | 'missing'> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM broadcasts WHERE id = ${broadcastId}::uuid FOR UPDATE`;
      if (!row) return 'missing' as const;
      if (row.status !== 'QUEUED') return 'already_started' as const;
      const now = this.clock();
      const inserted = await tx.$executeRaw`
        INSERT INTO broadcast_recipients (broadcast_id, customer_id)
        SELECT ${broadcastId}::uuid, s.customer_id FROM ${ENTITLED_FROM}
        WHERE s.creator_id = (SELECT creator_id FROM broadcasts WHERE id = ${broadcastId}::uuid)
          AND ${entitledSubscriptionSql(now)}
        ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`
        UPDATE broadcasts
        SET status = 'FANNING_OUT', snapshot_at = ${now}, recipient_count = ${inserted}
        WHERE id = ${broadcastId}::uuid`;
      return 'started' as const;
    });
  }

  /** Delivers up to `limit` PENDING recipients, each in its own transaction. */
  async deliverBatch(broadcastId: string, limit = 50): Promise<BatchResult> {
    const pending = await this.prisma.$queryRaw<{ customer_id: string }[]>`
      SELECT customer_id::text AS customer_id FROM broadcast_recipients
      WHERE broadcast_id = ${broadcastId}::uuid AND status = 'PENDING'
      ORDER BY customer_id LIMIT ${limit}`;
    const result: BatchResult = { delivered: 0, skipped: 0, failed: 0, remaining: 0 };
    for (const { customer_id } of pending) {
      const outcome = await this.deliverOne(broadcastId, customer_id);
      if (outcome === 'delivered') result.delivered += 1;
      else if (outcome === 'skipped') result.skipped += 1;
      else if (outcome === 'failed') result.failed += 1;
    }
    const [left] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM broadcast_recipients
      WHERE broadcast_id = ${broadcastId}::uuid AND status = 'PENDING'`;
    result.remaining = left?.n ?? 0;
    return result;
  }

  /**
   * COMPLETED once no recipient is PENDING (one still being delivered by another worker counts).
   * A broadcast that is already COMPLETED answers true, so a repeated job ends instead of coming back.
   */
  async finish(broadcastId: string): Promise<boolean> {
    const done = await this.prisma.$executeRaw`
      UPDATE broadcasts SET status = 'COMPLETED', completed_at = ${this.clock()}
      WHERE id = ${broadcastId}::uuid AND status = 'FANNING_OUT'
        AND NOT EXISTS (
          SELECT 1 FROM broadcast_recipients
          WHERE broadcast_id = ${broadcastId}::uuid AND status = 'PENDING')`;
    if (done === 1) return true;
    const [row] = await this.prisma.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM broadcasts WHERE id = ${broadcastId}::uuid`;
    return row?.status === 'COMPLETED';
  }

  private async deliverOne(broadcastId: string, customerId: string): Promise<DeliverOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = this.clock();
        // The recipient row first (a second worker skips it), then the conversation: one lock order.
        const [recipient] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM broadcast_recipients
          WHERE broadcast_id = ${broadcastId}::uuid AND customer_id = ${customerId}::uuid
            AND status = 'PENDING'
          FOR UPDATE SKIP LOCKED`;
        if (!recipient) return 'busy' as const;
        const [broadcast] = await tx.$queryRaw<
          { creator_id: string; asset_id: string; body: string | null }[]
        >`SELECT creator_id::text AS creator_id, asset_id::text AS asset_id, body
          FROM broadcasts WHERE id = ${broadcastId}::uuid`;
        if (!broadcast) return 'missing' as const;

        const skip = async (reason: SkipReason) => {
          await tx.$executeRaw`
            UPDATE broadcast_recipients
            SET status = 'SKIPPED', reason = ${reason}, updated_at = ${now}
            WHERE broadcast_id = ${broadcastId}::uuid AND customer_id = ${customerId}::uuid`;
          return 'skipped' as const;
        };
        const check = () => checkCreatorCanMessage(tx, broadcast.creator_id, customerId, now);
        const first = await check();
        if (!first.ok) return skip(first.reason);

        // A customer in the snapshot normally has a conversation (the grant made it); make it if not.
        await tx.$executeRaw`
          INSERT INTO conversations (customer_id, creator_id, updated_at)
          VALUES (${customerId}::uuid, ${broadcast.creator_id}::uuid, ${now})
          ON CONFLICT (customer_id, creator_id) DO NOTHING`;
        const [conversation] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM conversations
          WHERE customer_id = ${customerId}::uuid AND creator_id = ${broadcast.creator_id}::uuid
          FOR UPDATE`;
        if (!conversation) return 'failed' as const;

        // Checked again under the conversation lock: a block or a revoke that landed meanwhile wins.
        const again = await check();
        if (!again.ok) return skip(again.reason);

        const message = await writeCreatorMessage(tx, this.outbox, {
          conversationId: conversation.id,
          creatorUserId: again.ownerUserId,
          clientMessageId: recipient.id,
          body: broadcast.body,
          assetId: broadcast.asset_id,
          broadcastId,
          now,
        });
        await tx.$executeRaw`
          UPDATE broadcast_recipients
          SET status = 'DELIVERED', message_id = ${message.id}::uuid, reason = NULL, updated_at = ${now}
          WHERE broadcast_id = ${broadcastId}::uuid AND customer_id = ${customerId}::uuid`;
        return 'delivered' as const;
      });
    } catch {
      // A technical failure rolled this recipient back: count the try, give up after a few.
      const now = this.clock();
      await this.prisma.$executeRaw`
        UPDATE broadcast_recipients
        SET attempts = attempts + 1,
            status = CASE WHEN attempts + 1 >= ${RECIPIENT_MAX_ATTEMPTS} THEN 'FAILED'::"BroadcastRecipientStatus" ELSE status END,
            reason = CASE WHEN attempts + 1 >= ${RECIPIENT_MAX_ATTEMPTS} THEN 'delivery_error' ELSE reason END,
            updated_at = ${now}
        WHERE broadcast_id = ${broadcastId}::uuid AND customer_id = ${customerId}::uuid
          AND status = 'PENDING'`;
      return 'failed';
    }
  }
}
