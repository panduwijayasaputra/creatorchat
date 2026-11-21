import { backoffMs, type BroadcastProcessor } from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';

/** An unexpected error is retried this many times before the event is given up. */
export const BROADCAST_MAX_ATTEMPTS = 5;
/** One job works this long, then hands the rest to the next job (a big audience cannot hog the worker). */
export const BROADCAST_BUDGET_MS = 20_000;

/**
 * Handles one `broadcast.created` outbox event and settles it. `done` closes the event; `continue`
 * (time budget used up) puts it straight back so the next tick queues it again, without counting an
 * attempt; an unexpected error puts it back with a delay, and after the last attempt it is FAILED
 * (the broadcast stays FANNING_OUT with its recipient states for an admin to see). The queue is
 * only a courier: every outcome is written to PostgreSQL.
 */
export class BroadcastEventHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly processor: BroadcastProcessor,
    private readonly options: { budgetMs?: number; clock?: () => Date } = {},
  ) {}

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  async process(eventId: string): Promise<string> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return 'missing';
    if (event.status === 'DONE' || event.status === 'FAILED') return 'duplicate';
    try {
      const outcome = await this.processor.run(eventId, {
        budgetMs: this.options.budgetMs ?? BROADCAST_BUDGET_MS,
      });
      if (outcome === 'done') {
        await this.finish(eventId, 'DONE', null);
      } else if (outcome === 'missing') {
        await this.finish(eventId, 'FAILED', 'broadcast_missing');
      } else {
        await this.prisma.outboxEvent.updateMany({
          where: { id: eventId, status: { in: ['PENDING', 'ENQUEUED'] } },
          data: { status: 'PENDING', availableAt: this.now(), lastError: null },
        });
      }
      return outcome;
    } catch {
      // The error text is not kept: it could echo a connection string.
      const attempts = event.attempts + 1;
      if (attempts >= BROADCAST_MAX_ATTEMPTS) {
        await this.finish(eventId, 'FAILED', 'fanout_error');
        return 'failed';
      }
      await this.prisma.outboxEvent.updateMany({
        where: { id: eventId, status: { in: ['PENDING', 'ENQUEUED'] } },
        data: {
          status: 'PENDING',
          availableAt: new Date(this.now().getTime() + backoffMs(attempts)),
          lastError: 'fanout_error',
          attempts: { increment: 1 },
        },
      });
      return 'retry';
    }
  }

  private async finish(id: string, status: 'DONE' | 'FAILED', lastError: string | null) {
    await this.prisma.outboxEvent.updateMany({
      where: { id, status: { in: ['PENDING', 'ENQUEUED'] } },
      data: { status, processedAt: this.now(), lastError, attempts: { increment: 1 } },
    });
  }
}
