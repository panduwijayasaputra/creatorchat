import type { PrismaClient } from '@creatorchat/db';
import type { BroadcastFanOutService } from './fan-out.service.js';

export type BroadcastRunResult = 'done' | 'continue' | 'missing';

/**
 * Runs the fan-out of the broadcast that an outbox event points at. The broadcast id comes from the
 * event's `aggregate_id` (the payload is never trusted). Work is cut into batches and stops after a
 * time budget, so one big broadcast cannot occupy the worker; `continue` means "queue me again".
 */
export class BroadcastProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fanOut: BroadcastFanOutService,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async run(
    eventId: string,
    options: { budgetMs: number; batchSize?: number },
  ): Promise<BroadcastRunResult> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { type: true, aggregateId: true },
    });
    if (!event || event.type !== 'broadcast.created') return 'missing';
    const broadcastId = event.aggregateId;

    if ((await this.fanOut.start(broadcastId)) === 'missing') return 'missing';
    const deadline = this.now() + options.budgetMs;
    for (;;) {
      const batch = await this.fanOut.deliverBatch(broadcastId, options.batchSize ?? 50);
      if (batch.remaining === 0) break;
      // Everything left is being delivered by another worker, or the time is up: come back later.
      const progressed = batch.delivered + batch.skipped + batch.failed > 0;
      if (!progressed || this.now() >= deadline) return 'continue';
    }
    return (await this.fanOut.finish(broadcastId)) ? 'done' : 'continue';
  }
}
