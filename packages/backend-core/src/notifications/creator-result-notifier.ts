import type { PrismaClient } from '@creatorchat/db';
import { backoffMs, clampRetryAfterMs, MAX_ATTEMPTS } from './backoff.js';
import { buildCreatorResultMessage } from './creator-result-message.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

export const CREATOR_RESULT_EVENT_TYPES = [
  'creator_application.approved',
  'creator_application.rejected',
] as const;

export type NotifyResult =
  'sent' | 'blocked' | 'skipped' | 'retry' | 'failed' | 'duplicate' | 'missing';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const CODE = /^[a-z0-9_]{1,32}$/;
const safeCode = (code: string) => (CODE.test(code) ? code : 'error');

/**
 * Sends the creator-request result (US-013) for one outbox event. At-least-once: the delivery row
 * is claimed before the send, the send happens outside any transaction, and a timeout or crash is
 * retried and flagged (`ambiguous_attempts`) because the message may already have arrived.
 * The application and the user's role are never written; the recipient and the text are read from
 * the database by id, never from the event payload.
 */
export class CreatorResultNotifier {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sender: TelegramSender,
    private readonly options: { miniAppUrl: string | undefined; clock?: () => Date },
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async process(eventId: string): Promise<NotifyResult> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event || !(CREATOR_RESULT_EVENT_TYPES as readonly string[]).includes(event.type)) {
      return 'missing';
    }
    if (event.status === 'DONE' || event.status === 'FAILED') return 'duplicate';
    const decision = event.type.endsWith('.approved') ? 'approved' : 'rejected';

    const application = await this.prisma.creatorApplication.findUnique({
      where: { id: event.aggregateId },
      select: { status: true, reviewReason: true, user: { select: this.userSelect } },
    });
    if (!application) {
      await this.finishEvent(this.prisma, eventId, 'FAILED', 'application_missing');
      return 'failed';
    }
    const expected = decision === 'approved' ? 'APPROVED' : 'REJECTED';
    if (application.status !== expected) {
      await this.finishEvent(this.prisma, eventId, 'FAILED', 'decision_mismatch');
      return 'failed';
    }

    const user = application.user;
    const dedupeKey = `creator_application:${event.aggregateId}:decision:telegram`;
    await this.prisma.notificationDelivery.createMany({
      data: [
        { dedupeKey, outboxEventId: eventId, userId: user.id, kind: 'creator_application_result' },
      ],
      skipDuplicates: true,
    });
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

    const message = buildCreatorResultMessage({
      decision,
      reason: application.reviewReason,
      miniAppUrl: this.options.miniAppUrl,
    });
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

  private readonly userSelect = {
    id: true,
    telegramId: true,
    status: true,
    botBlockedAt: true,
  } as const;

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
    db: Tx | PrismaClient,
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
    db: Tx | PrismaClient,
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
