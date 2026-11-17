import { backoffMs, type MediaUploadService } from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import type { MediaProcessor } from './media-processor.js';

/** An unexpected error is retried this many times before the file counts as unreadable. */
export const MEDIA_MAX_ATTEMPTS = 3;

/**
 * Handles one `media.uploaded` outbox event: processes the asset and settles the event. An expected
 * failure (a bad file) is a finished job; an unexpected error puts the event back with a delay, and
 * after the last attempt the asset becomes FAILED. The queue is only a courier.
 */
export class MediaEventHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly processor: MediaProcessor,
    private readonly uploads: MediaUploadService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async process(eventId: string): Promise<string> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return 'missing';
    if (event.status === 'DONE' || event.status === 'FAILED') return 'duplicate';
    const assetId = (event.payload as { asset_id?: string } | null)?.asset_id;
    if (!assetId) {
      await this.finish(eventId, 'FAILED', 'bad_payload');
      return 'bad_payload';
    }
    try {
      const outcome = await this.processor.process(assetId);
      await this.finish(eventId, 'DONE', null);
      return outcome;
    } catch {
      // The error text is not kept: it could echo a path or a URL.
      const attempts = event.attempts + 1;
      if (attempts >= MEDIA_MAX_ATTEMPTS) {
        await this.uploads.markFailed(assetId, 'UNREADABLE');
        await this.finish(eventId, 'FAILED', 'max_attempts');
        return 'failed';
      }
      await this.prisma.outboxEvent.updateMany({
        where: { id: eventId, status: { in: ['PENDING', 'ENQUEUED'] } },
        data: {
          status: 'PENDING',
          availableAt: new Date(this.clock().getTime() + backoffMs(attempts)),
          lastError: 'processing_error',
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
