import type { JobQueue } from '@creatorchat/backend-core';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const MEDIA_QUEUE = 'media';

/** BullMQ's blocking commands need `maxRetriesPerRequest: null` (the health probe keeps its own). */
function connect(redisUrl: string): Redis {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', () => undefined); // an unreachable Redis is surfaced by the dependency probe
  return redis;
}

export interface NotificationQueue extends JobQueue {
  close(): Promise<void>;
}

/** The dispatcher's side: adds one job per outbox event, job id = event id (a repeat is a no-op). */
export function createNotificationQueue(options: {
  redisUrl: string;
  prefix?: string;
  /** Another pipeline's queue (US-032 `media`); defaults to `notifications`. */
  name?: string;
}): NotificationQueue {
  const connection = connect(options.redisUrl);
  const queue = new Queue(options.name ?? NOTIFICATIONS_QUEUE, {
    connection,
    prefix: options.prefix ?? 'bull',
    defaultJobOptions: {
      attempts: 1, // retries live in PostgreSQL, never in the queue
      // Removed at once: a retry re-adds the same job id (the event id), and BullMQ ignores an id
      // that still exists. The outcome lives in PostgreSQL, not in the finished job.
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  queue.on('error', () => undefined);
  return {
    async add(job) {
      await queue.add(job.name, job.data, { jobId: job.jobId });
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}

export interface NotificationWorker {
  close(): Promise<void>;
}

/**
 * The consumer's side. The handler's result is only logged: the job always completes, because the
 * business outcome (sent, retry, failed) is recorded in PostgreSQL by the handler itself.
 */
export function createNotificationWorker(options: {
  redisUrl: string;
  prefix?: string;
  name?: string;
  logger: Logger;
  concurrency?: number;
  handler: (eventId: string, jobName: string) => Promise<string>;
}): NotificationWorker {
  const connection = connect(options.redisUrl);
  const worker = new Worker(
    options.name ?? NOTIFICATIONS_QUEUE,
    async (job) => {
      try {
        const outcome = await options.handler(String(job.data?.eventId ?? job.id), job.name);
        options.logger.info({ eventId: job.id, outcome }, 'notification processed');
      } catch (error) {
        // Class name only. The event stays in the outbox; the reconciler picks it up.
        options.logger.error(
          { eventId: job.id, error: error instanceof Error ? error.name : 'Error' },
          'notification handler failed',
        );
      }
    },
    {
      connection,
      prefix: options.prefix ?? 'bull',
      concurrency: options.concurrency ?? 5,
    },
  );
  worker.on('error', () => undefined);
  return {
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}
