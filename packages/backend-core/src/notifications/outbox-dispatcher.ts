import type { PrismaClient } from '@creatorchat/db';
import { backoffMs, MAX_ATTEMPTS } from './backoff.js';
import type { JobQueue } from './job-queue.js';

export interface OutboxDispatcherOptions {
  /** Only these event types are claimed; others are left for their own consumers. */
  handledTypes: readonly string[];
  batchSize?: number;
  clock?: () => Date;
  staleEnqueuedMs?: number;
  staleSendingMs?: number;
}

export interface DispatchResult {
  enqueued: number;
  /** Rows left PENDING because the queue refused them (retried on the next tick). */
  failed: number;
}

/**
 * Moves committed outbox events to the queue (brief §14) and repairs what a crash left behind.
 * The queue is a courier, not the source of truth: every state that matters is in PostgreSQL.
 */
export class OutboxDispatcher {
  private readonly batchSize: number;
  private readonly clock: () => Date;
  private readonly staleEnqueuedMs: number;
  private readonly staleSendingMs: number;
  private readonly handled: string[];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: JobQueue,
    options: OutboxDispatcherOptions,
  ) {
    this.handled = [...options.handledTypes];
    this.batchSize = options.batchSize ?? 50;
    this.clock = options.clock ?? (() => new Date());
    this.staleEnqueuedMs = options.staleEnqueuedMs ?? 2 * 60_000;
    this.staleSendingMs = options.staleSendingMs ?? 2 * 60_000;
  }

  /**
   * Claims due `PENDING` events (`FOR UPDATE SKIP LOCKED`, so racing dispatchers take different
   * rows), enqueues each with job id = event id, then marks them `ENQUEUED`. Enqueue comes first: a
   * crash in between leaves a `PENDING` row that is simply enqueued again (same job id).
   */
  async dispatch(): Promise<DispatchResult> {
    if (this.handled.length === 0) return { enqueued: 0, failed: 0 };
    const now = this.clock();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; type: string }[]>`
        SELECT id::text AS id, type FROM outbox_events
        WHERE status = 'PENDING' AND available_at <= ${now}::timestamptz
          AND type = ANY(${this.handled}::text[])
        ORDER BY available_at, created_at
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED`;
      const done: string[] = [];
      let failed = 0;
      for (const row of rows) {
        try {
          await this.queue.add({ jobId: row.id, name: row.type, data: { eventId: row.id } });
          done.push(row.id);
        } catch {
          failed += 1; // the row stays PENDING; the error text is not kept (it could echo a URL)
        }
      }
      if (done.length > 0) {
        await tx.$executeRaw`
          UPDATE outbox_events SET status = 'ENQUEUED', enqueued_at = ${now}::timestamptz
          WHERE id = ANY(${done}::uuid[])`;
      }
      return { enqueued: done.length, failed };
    });
  }

  /**
   * Repairs stale state: `ENQUEUED` events whose job never ran go back to `PENDING`, and deliveries
   * stuck in `SENDING` (a worker died, maybe after Telegram accepted the message) become an
   * ambiguous retry, or `FAILED` once the attempt cap is reached.
   */
  async reconcile(): Promise<{ requeued: number; ambiguous: number }> {
    if (this.handled.length === 0) return { requeued: 0, ambiguous: 0 };
    const now = this.clock();
    const staleEnqueued = new Date(now.getTime() - this.staleEnqueuedMs);
    const staleSending = new Date(now.getTime() - this.staleSendingMs);

    const ambiguous = await this.prisma.$transaction(async (tx) => {
      const stale = await tx.$queryRaw<{ id: string; event_id: string; attempts: number }[]>`
        SELECT d.id::text AS id, d.outbox_event_id::text AS event_id, d.attempts
        FROM notification_deliveries d
        JOIN outbox_events e ON e.id = d.outbox_event_id
        WHERE d.status = 'SENDING' AND d.claimed_at < ${staleSending}::timestamptz
          AND e.type = ANY(${this.handled}::text[])
        FOR UPDATE OF d SKIP LOCKED`;
      for (const row of stale) {
        if (row.attempts >= MAX_ATTEMPTS) {
          await tx.$executeRaw`
            UPDATE notification_deliveries
            SET status = 'FAILED', last_error_code = 'max_attempts', claimed_at = NULL, updated_at = ${now}::timestamptz
            WHERE id = ${row.id}::uuid`;
          await tx.$executeRaw`
            UPDATE outbox_events
            SET status = 'FAILED', last_error = 'max_attempts', processed_at = ${now}::timestamptz
            WHERE id = ${row.event_id}::uuid AND status IN ('PENDING', 'ENQUEUED')`;
          continue;
        }
        const next = new Date(now.getTime() + backoffMs(row.attempts));
        await tx.$executeRaw`
          UPDATE notification_deliveries
          SET status = 'PENDING', ambiguous_attempts = ambiguous_attempts + 1,
              last_error_code = 'interrupted', claimed_at = NULL, updated_at = ${now}::timestamptz
          WHERE id = ${row.id}::uuid`;
        await tx.$executeRaw`
          UPDATE outbox_events
          SET status = 'PENDING', available_at = ${next}::timestamptz
          WHERE id = ${row.event_id}::uuid AND status IN ('PENDING', 'ENQUEUED')`;
      }
      return stale.length;
    });

    const requeued = await this.prisma.$executeRaw`
      UPDATE outbox_events SET status = 'PENDING'
      WHERE status = 'ENQUEUED' AND enqueued_at < ${staleEnqueued}::timestamptz
        AND type = ANY(${this.handled}::text[])`;
    return { requeued, ambiguous };
  }
}
