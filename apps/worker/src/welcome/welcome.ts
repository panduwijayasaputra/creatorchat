import {
  OutboxDispatcher,
  OutboxService,
  WelcomeDeliveryService,
  type ServerEnv,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import type { Logger } from 'pino';
import { startOutboxLoops } from '../outbox/loops.js';
import {
  createNotificationQueue,
  createNotificationWorker,
  WELCOME_QUEUE,
} from '../queue/bullmq-queue.js';
import { WelcomeEventHandler } from './welcome-events.js';

export interface WelcomeOptions {
  env: Pick<ServerEnv, 'REDIS_URL'>;
  prisma: PrismaClient;
  logger: Logger;
  queuePrefix?: string;
  intervalMs?: number;
  reconcileMs?: number;
  staleEnqueuedMs?: number;
}

export interface Welcome {
  stop(): Promise<void>;
}

/**
 * Wires the welcome-message pipeline: outbox loop -> `welcome` queue -> `WelcomeDeliveryService`
 * (one creator message into a new subscriber's chat). It needs nothing but PostgreSQL and Redis.
 */
export function startWelcome(options: WelcomeOptions): Welcome {
  const { env, logger, prisma } = options;
  const prefix = options.queuePrefix ?? 'bull';
  const handler = new WelcomeEventHandler(
    prisma,
    new WelcomeDeliveryService(prisma, new OutboxService()),
  );

  const queue = createNotificationQueue({ redisUrl: env.REDIS_URL, prefix, name: WELCOME_QUEUE });
  const consumer = createNotificationWorker({
    redisUrl: env.REDIS_URL,
    prefix,
    name: WELCOME_QUEUE,
    logger,
    concurrency: 2,
    handler: (eventId) => handler.process(eventId),
  });
  const dispatcher = new OutboxDispatcher(prisma, queue, {
    handledTypes: ['welcome.requested'],
    ...(options.staleEnqueuedMs !== undefined ? { staleEnqueuedMs: options.staleEnqueuedMs } : {}),
  });
  const loops = startOutboxLoops({
    dispatcher,
    logger,
    ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    ...(options.reconcileMs !== undefined ? { reconcileMs: options.reconcileMs } : {}),
  });

  logger.info('welcome started');
  return {
    async stop() {
      await loops.stop();
      await consumer.close();
      await queue.close();
    },
  };
}
