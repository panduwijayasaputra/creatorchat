import type { PrismaClient } from '@creatorchat/db';
import type { NotifyResult, TelegramDeliveryRunner } from './delivery-runner.js';
import type { NotificationHandler } from './handler.js';

/** Sends each outbox event to the handler registered for its type; one dispatcher serves them all. */
export class NotificationRouter {
  private readonly byType = new Map<string, NotificationHandler>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly runner: TelegramDeliveryRunner,
    handlers: readonly NotificationHandler[],
  ) {
    for (const handler of handlers) {
      for (const type of handler.types) {
        if (this.byType.has(type)) throw new Error(`Two notification handlers for "${type}".`);
        this.byType.set(type, handler);
      }
    }
  }

  /** The event types the dispatcher should claim for this router. */
  get handledTypes(): string[] {
    return [...this.byType.keys()];
  }

  async process(eventId: string): Promise<NotifyResult> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        type: true,
        aggregateType: true,
        aggregateId: true,
        payload: true,
        createdAt: true,
      },
    });
    const handler = event ? this.byType.get(event.type) : undefined;
    if (!event || !handler) return 'missing';
    return this.runner.run(event, handler);
  }
}
