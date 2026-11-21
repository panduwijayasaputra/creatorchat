import { backoffMs, type WelcomeDeliveryService } from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';

/** An unexpected error is retried this many times before the event is given up. */
export const WELCOME_MAX_ATTEMPTS = 5;

/**
 * Handles one `welcome.requested` outbox event and settles it. Delivered, skipped (the switch was off,
 * the access had ended, someone is blocked) and duplicate all close the event as DONE: a skipped
 * welcome is never sent later, even if the creator switches it on afterwards (the reason is kept as a
 * short code in `last_error`). A subscription that is gone fails the event; an unexpected error puts it
 * back with a delay and, after the last attempt, FAILED. The queue is only a courier.
 */
export class WelcomeEventHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly service: WelcomeDeliveryService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async process(eventId: string): Promise<string> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return 'missing';
    if (event.status === 'DONE' || event.status === 'FAILED') return 'duplicate';
    try {
      const outcome = await this.service.deliver(eventId);
      switch (outcome.kind) {
        case 'delivered':
        case 'duplicate':
          await this.finish(eventId, 'DONE', null);
          return outcome.kind;
        case 'skipped':
          await this.finish(eventId, 'DONE', outcome.reason);
          return 'skipped';
        default:
          await this.finish(eventId, 'FAILED', 'welcome_missing');
          return 'missing';
      }
    } catch {
      // The error text is not kept: it could echo a connection string.
      const attempts = event.attempts + 1;
      if (attempts >= WELCOME_MAX_ATTEMPTS) {
        await this.finish(eventId, 'FAILED', 'welcome_error');
        return 'failed';
      }
      await this.prisma.outboxEvent.updateMany({
        where: { id: eventId, status: { in: ['PENDING', 'ENQUEUED'] } },
        data: {
          status: 'PENDING',
          availableAt: new Date(this.clock().getTime() + backoffMs(attempts)),
          lastError: 'welcome_error',
          attempts: { increment: 1 },
        },
      });
      return 'retry';
    }
  }

  private async finish(id: string, status: 'DONE' | 'FAILED', lastError: string | null) {
    await this.prisma.outboxEvent.updateMany({
      where: { id, status: { in: ['PENDING', 'ENQUEUED'] } },
      data: { status, processedAt: this.clock(), lastError, attempts: { increment: 1 } },
    });
  }
}
