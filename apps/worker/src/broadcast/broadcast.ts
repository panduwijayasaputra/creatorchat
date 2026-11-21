import {
  BroadcastFanOutService,
  BroadcastProcessor,
  OutboxDispatcher,
  OutboxService,
  type ServerEnv,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import type { Logger } from 'pino';
import { startOutboxLoops } from '../outbox/loops.js';
import {
  BROADCAST_QUEUE,
  createNotificationQueue,
  createNotificationWorker,
} from '../queue/bullmq-queue.js';
import { BroadcastEventHandler } from './broadcast-events.js';

export interface BroadcastOptions {
  env: Pick<ServerEnv, 'REDIS_URL'>;
  prisma: PrismaClient;
  logger: Logger;
  queuePrefix?: string;
  intervalMs?: number;
  reconcileMs?: number;
  staleEnqueuedMs?: number;
  budgetMs?: number;
}

export interface Broadcast {
  stop(): Promise<void>;
}

/**
 * Wires the broadcast pipeline: outbox loop -> `broadcast` queue -> processor (snapshot, then one
 * message per active subscriber). It needs nothing but PostgreSQL and Redis: no bot, no storage.
 */
export function startBroadcast(options: BroadcastOptions): Broadcast {
  const { env, logger, prisma } = options;
  const prefix = options.queuePrefix ?? 'bull';
  const fanOut = new BroadcastFanOutService(prisma, new OutboxService());
  const handler = new BroadcastEventHandler(prisma, new BroadcastProcessor(prisma, fanOut), {
    ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
  });

  const queue = createNotificationQueue({ redisUrl: env.REDIS_URL, prefix, name: BROADCAST_QUEUE });
  const consumer = createNotificationWorker({
    redisUrl: env.REDIS_URL,
    prefix,
    name: BROADCAST_QUEUE,
    logger,
    concurrency: 2,
    handler: (eventId) => handler.process(eventId),
  });
  const dispatcher = new OutboxDispatcher(prisma, queue, {
    handledTypes: ['broadcast.created'],
    // A job works up to its time budget; do not queue it again under a running job too early.
    staleEnqueuedMs: options.staleEnqueuedMs ?? 5 * 60_000,
  });
  const loops = startOutboxLoops({
    dispatcher,
    logger,
    ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    ...(options.reconcileMs !== undefined ? { reconcileMs: options.reconcileMs } : {}),
  });

  logger.info('broadcast started');
  return {
    async stop() {
      await loops.stop();
      await consumer.close();
      await queue.close();
    },
  };
}
