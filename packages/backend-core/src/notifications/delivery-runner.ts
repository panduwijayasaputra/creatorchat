import type { PrismaClient } from '@creatorchat/db';
import { backoffMs, clampRetryAfterMs, MAX_ATTEMPTS } from './backoff.js';
import {
  SkipDelivery,
  type DeliveryTx,
  type NotificationEvent,
  type NotificationHandler,
} from './handler.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

export type NotifyResult =
  'sent' | 'blocked' | 'skipped' | 'retry' | 'failed' | 'duplicate' | 'missing';

const CODE = /^[a-z0-9_]{1,32}$/;
const safeCode = (code: string) => (CODE.test(code) ? code : 'error');

/**
 * The claim -> send -> record state machine for one Telegram notification (US-013, shared since
 * US-044). At-least-once: the delivery row is claimed before the send, the send happens outside any
 * transaction, and a timeout or crash is retried and flagged (`ambiguous_attempts`) because the
 * message may already have arrived. What to send, and to whom, comes from a `NotificationHandler`;
 * the recipient and the text are read from the database by id, never from the event payload.
 */
export class TelegramDeliveryRunner {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sender: TelegramSender,
    private readonly options: { miniAppUrl: string | undefined; clock?: () => Date },
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async run(event: NotificationEvent, handler: NotificationHandler): Promise<NotifyResult> {
    const eventId = event.id;
    const current = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { status: true },
    });
    if (!current || current.status === 'DONE' || current.status === 'FAILED') return 'duplicate';

    const existingDelivery = await this.prisma.notificationDelivery.findFirst({
      where: { outboxEventId: eventId },
      select: { id: true, dedupeKey: true, status: true },
    });
    const resolution = await handler.resolve(event, {
      prisma: this.prisma,
      now: this.clock(),
      miniAppUrl: this.options.miniAppUrl,
      existingDelivery,
    });

    if (resolution.kind === 'fail') {
      await this.finishEvent(this.prisma, eventId, 'FAILED', safeCode(resolution.code));
      return 'failed';
    }

    if (resolution.kind === 'skip') return this.recordSkip(eventId, resolution, resolution.reason);

    const user = resolution.recipient;
    const dedupeKey = resolution.dedupeKey;
    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.notificationDelivery.createMany({
          data: [
            { dedupeKey, outboxEventId: eventId, userId: user.id, kind: resolution.deliveryKind },
          ],
          skipDuplicates: true,
        });
        if (created.count === 1 && resolution.afterCreate) await resolution.afterCreate(tx);
      });
    } catch (error) {
      // A decision that needed the transaction's locks said "do not send": the row was rolled back.
      if (error instanceof SkipDelivery) {
        return this.recordSkip(
          eventId,
          { recipientId: user.id, deliveryKind: resolution.deliveryKind, dedupeKey },
          error.reason,
        );
      }
      throw error;
    }
    const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { dedupeKey },
    });

    if (delivery.status === 'SENDING') return 'duplicate'; // another worker is on it
    if (delivery.status !== 'PENDING') {
      // Already settled: close the event (a FAILED delivery keeps its failure) and send nothing.
      await this.finishEvent(
        this.prisma,
        eventId,
        delivery.status === 'FAILED' ? 'FAILED' : 'DONE',
        delivery.status === 'FAILED' ? (delivery.lastErrorCode ?? 'failed') : null,
      );
      return 'duplicate';
    }

    if (user.status === 'BLOCKED' || user.botBlockedAt) {
      const reason = user.status === 'BLOCKED' ? 'account_blocked' : 'bot_blocked';
      await this.prisma.$transaction(async (tx) => {
        await tx.notificationDelivery.updateMany({
          where: { id: delivery.id, status: 'PENDING' },
          data: { status: 'SKIPPED', lastErrorCode: reason },
        });
        await this.finishEvent(tx, eventId, 'DONE', null);
      });
      return 'skipped';
    }

    const message = resolution.message;
    if (!message) {
      // Not configured: wait without spending an attempt.
      await this.retryEvent(this.prisma, eventId, 60_000, 'not_configured');
      return 'retry';
    }

    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: delivery.id, status: 'PENDING' },
      data: { status: 'SENDING', attempts: { increment: 1 }, claimedAt: this.clock() },
    });
    if (claimed.count !== 1) return 'duplicate';
    const attempts = delivery.attempts + 1;

    let outcome: SendOutcome;
    try {
      outcome = await this.sender.sendMessage(user.telegramId, message);
    } catch {
      outcome = { kind: 'ambiguous', code: 'sender_error' }; // the error text is dropped on purpose
    }
    return this.record(eventId, delivery.id, user.id, attempts, outcome);
  }

  /** A SKIPPED delivery (nothing is sent) and the event closed as DONE; the reason is a short code. */
  private async recordSkip(
    eventId: string,
    target: { recipientId: string; deliveryKind: string; dedupeKey: string },
    reason: string,
  ): Promise<NotifyResult> {
    const code = safeCode(reason);
    await this.prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.createMany({
        data: [
          {
            dedupeKey: target.dedupeKey,
            outboxEventId: eventId,
            userId: target.recipientId,
            kind: target.deliveryKind,
            status: 'SKIPPED',
            lastErrorCode: code,
          },
        ],
        skipDuplicates: true,
      });
      // A PENDING delivery of an earlier attempt is closed too (it is never sent now).
      await tx.notificationDelivery.updateMany({
        where: { dedupeKey: target.dedupeKey, status: 'PENDING' },
        data: { status: 'SKIPPED', lastErrorCode: code },
      });
      await this.finishEvent(tx, eventId, 'DONE', null);
    });
    return 'skipped';
  }

  private async record(
    eventId: string,
    deliveryId: string,
    userId: string,
    attempts: number,
    outcome: SendOutcome,
  ): Promise<NotifyResult> {
    const now = this.clock();
    return this.prisma.$transaction(async (tx) => {
      const settle = async (
        status: 'SENT' | 'BOT_BLOCKED' | 'FAILED',
        data: { lastErrorCode?: string; telegramMessageId?: bigint; sentAt?: Date },
      ) => {
        const done = await tx.notificationDelivery.updateMany({
          where: { id: deliveryId, status: { in: ['SENDING', 'PENDING'] } },
          data: { status, claimedAt: null, ...data },
        });
        return done.count === 1;
      };

      switch (outcome.kind) {
        case 'ok': {
          await settle('SENT', { telegramMessageId: BigInt(outcome.messageId), sentAt: now });
          await this.finishEvent(tx, eventId, 'DONE', null);
          return 'sent';
        }
        case 'blocked': {
          await settle('BOT_BLOCKED', { lastErrorCode: 'blocked' });
          await tx.user.update({ where: { id: userId }, data: { botBlockedAt: now } });
          await this.finishEvent(tx, eventId, 'DONE', null);
          return 'blocked';
        }
        case 'permanent': {
          const code = safeCode(outcome.code);
          await settle('FAILED', { lastErrorCode: code });
          await this.finishEvent(tx, eventId, 'FAILED', code);
          return 'failed';
        }
        default: {
          const code = outcome.kind === 'rate_limited' ? 'rate_limited' : safeCode(outcome.code);
          if (attempts >= MAX_ATTEMPTS) {
            await settle('FAILED', { lastErrorCode: 'max_attempts' });
            await this.finishEvent(tx, eventId, 'FAILED', 'max_attempts');
            return 'failed';
          }
          const delay =
            outcome.kind === 'rate_limited'
              ? clampRetryAfterMs(outcome.retryAfterSeconds)
              : backoffMs(attempts);
          await tx.notificationDelivery.updateMany({
            where: { id: deliveryId, status: 'SENDING' },
            data: {
              status: 'PENDING',
              claimedAt: null,
              lastErrorCode: code,
              ...(outcome.kind === 'ambiguous' ? { ambiguousAttempts: { increment: 1 } } : {}),
            },
          });
          await this.retryEvent(tx, eventId, delay, code);
          return 'retry';
        }
      }
    });
  }

  private async finishEvent(
    db: DeliveryTx | PrismaClient,
    id: string,
    status: 'DONE' | 'FAILED',
    lastError: string | null,
  ): Promise<void> {
    await db.outboxEvent.updateMany({
      where: { id, status: { in: ['PENDING', 'ENQUEUED'] } },
      data: { status, processedAt: this.clock(), lastError, attempts: { increment: 1 } },
    });
  }

  private async retryEvent(
    db: DeliveryTx | PrismaClient,
    id: string,
    delayMs: number,
    lastError: string,
  ): Promise<void> {
    await db.outboxEvent.updateMany({
      where: { id, status: { in: ['PENDING', 'ENQUEUED'] } },
      data: {
        status: 'PENDING',
        availableAt: new Date(this.clock().getTime() + delayMs),
        lastError,
        attempts: { increment: 1 },
      },
    });
  }
}
