import type { PrismaClient } from '@creatorchat/db';
import { checkCreatorCanMessage, type RecipientRefusal } from '../chat/creator-recipient-check.js';
import { writeCreatorMessage } from '../chat/message-writer.js';
import type { OutboxService } from '../outbox/outbox.service.js';

export type WelcomeSkipReason = 'disabled' | RecipientRefusal;

export type WelcomeDeliveryOutcome =
  | { kind: 'delivered' }
  | { kind: 'skipped'; reason: WelcomeSkipReason }
  /** The pair was already handled (a repeated event, a retry, a racing job). */
  | { kind: 'duplicate' }
  /** No such event, another event type, or no such subscription. */
  | { kind: 'missing' };

/** Aborts the transaction (rolling back the delivery row) when the access changed under the lock. */
class Refused extends Error {
  constructor(readonly reason: RecipientRefusal) {
    super('welcome refused');
  }
}

/**
 * Writes a creator's welcome message into a new subscriber's chat (US-041). The event only names the
 * subscription; the customer, the creator, the text and the file are read from the database. The
 * welcome text and file are the ones saved at delivery time, so a later edit never changes a message
 * already sent, and a switch that is off then means nothing is sent (now or later).
 *
 * At most one per creator and customer, ever: the `welcome_deliveries` row is inserted first and a
 * conflict means "already handled"; its id is the message's `client_message_id`, so even a crash
 * after the commit cannot produce a second message. The message is a normal creator message (origin
 * MANUAL, no label), it never touches the conversation's mode or response version, and it asks for
 * no AI reply. Access, accounts and the switch are checked before and again under the conversation
 * lock; a refusal rolls everything back, so no delivery row is left behind for a skipped customer.
 */
export class WelcomeDeliveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async deliver(eventId: string): Promise<WelcomeDeliveryOutcome> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { type: true, aggregateId: true },
    });
    if (!event || event.type !== 'welcome.requested') return { kind: 'missing' };
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: event.aggregateId },
      select: { customerId: true, creatorId: true },
    });
    if (!subscription) return { kind: 'missing' };
    const { customerId, creatorId } = subscription;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = this.clock();
        const config = await tx.creatorWelcomeMessage.findUnique({
          where: { creatorId },
          select: {
            enabled: true,
            body: true,
            asset: { select: { id: true, state: true } },
          },
        });
        if (!config || !config.enabled || !config.body) {
          return { kind: 'skipped', reason: 'disabled' } as const;
        }
        const first = await checkCreatorCanMessage(tx, creatorId, customerId, now);
        if (!first.ok) return { kind: 'skipped', reason: first.reason } as const;

        // The pair first: a second job, a retry or a crash after the commit finds this row.
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO welcome_deliveries (creator_id, customer_id)
          VALUES (${creatorId}::uuid, ${customerId}::uuid)
          ON CONFLICT (creator_id, customer_id) DO NOTHING
          RETURNING id::text AS id`;
        if (!row) return { kind: 'duplicate' } as const;

        // A customer with access normally has a conversation (the grant made it); make it if not.
        await tx.$executeRaw`
          INSERT INTO conversations (customer_id, creator_id, updated_at)
          VALUES (${customerId}::uuid, ${creatorId}::uuid, ${now})
          ON CONFLICT (customer_id, creator_id) DO NOTHING`;
        const [conversation] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id FROM conversations
          WHERE customer_id = ${customerId}::uuid AND creator_id = ${creatorId}::uuid
          FOR UPDATE`;
        if (!conversation) throw new Error('conversation missing');

        // Checked again under the lock: a block or a revoke that landed meanwhile wins.
        const again = await checkCreatorCanMessage(tx, creatorId, customerId, now);
        if (!again.ok) throw new Refused(again.reason);

        // The text is the product; a file that is not READY any more is left out.
        const assetId = config.asset?.state === 'READY' ? config.asset.id : null;
        const message = await writeCreatorMessage(tx, this.outbox, {
          conversationId: conversation.id,
          creatorUserId: again.ownerUserId,
          clientMessageId: row.id,
          body: config.body,
          assetId,
          now,
        });
        await tx.$executeRaw`
          UPDATE welcome_deliveries SET message_id = ${message.id}::uuid
          WHERE creator_id = ${creatorId}::uuid AND customer_id = ${customerId}::uuid`;
        return { kind: 'delivered' } as const;
      });
    } catch (error) {
      if (error instanceof Refused) return { kind: 'skipped', reason: error.reason };
      throw error;
    }
  }
}
