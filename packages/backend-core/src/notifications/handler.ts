import type { PrismaClient } from '@creatorchat/db';
import type { BotMessage } from './creator-result-message.js';

export type DeliveryTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** The outbox row a handler resolves. */
export interface NotificationEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
}

/** Who the Telegram message goes to, always loaded from the database (never from the payload). */
export interface DeliveryRecipient {
  id: string;
  telegramId: bigint;
  status: 'ACTIVE' | 'BLOCKED';
  botBlockedAt: Date | null;
}

/**
 * Thrown from `afterCreate` when a decision that needed the transaction's locks turns out to be "do
 * not send" (for instance another job already covered this message): the delivery row is rolled
 * back and the runner records a SKIPPED delivery with this reason instead.
 */
export class SkipDelivery extends Error {
  constructor(readonly reason: string) {
    super('skip delivery');
    this.name = 'SkipDelivery';
  }
}

export type Resolution =
  | {
      kind: 'send';
      recipient: DeliveryRecipient;
      /** Short machine label stored on the delivery row, e.g. `access_activated`. */
      deliveryKind: string;
      /** Unique per business fact and recipient (`notification_deliveries.dedupe_key`). */
      dedupeKey: string;
      /** `null` = the Mini App URL is not configured: the event waits, no attempt is spent. */
      message: BotMessage | null;
      /** Runs in the transaction that creates the delivery row, only when that row is new. */
      afterCreate?: (tx: DeliveryTx) => Promise<void>;
    }
  | {
      kind: 'skip';
      recipientId: string;
      deliveryKind: string;
      dedupeKey: string;
      /** Short code (`^[a-z0-9_]{1,32}$`); never free text. */
      reason: string;
    }
  | { kind: 'fail'; code: string };

export interface ResolveContext {
  prisma: PrismaClient;
  now: Date;
  miniAppUrl: string | undefined;
  /**
   * The delivery this event already created (a retry). A handler must not skip it because of state
   * the first attempt changed itself.
   */
  existingDelivery: { id: string; dedupeKey: string; status: string } | null;
}

/** One notification kind: decides who gets what for an outbox event, or why nobody does. */
export interface NotificationHandler {
  readonly types: readonly string[];
  resolve(event: NotificationEvent, ctx: ResolveContext): Promise<Resolution>;
}
