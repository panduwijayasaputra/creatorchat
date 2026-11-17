import {
  CREATOR_RESULT_EVENT_TYPES,
  CreatorResultNotifier,
  OutboxDispatcher,
  type ServerEnv,
  type TelegramSender,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import type { Logger } from 'pino';
import { startOutboxLoops } from './outbox/loops.js';
import { createNotificationQueue, createNotificationWorker } from './queue/bullmq-queue.js';
import { createGrammySender } from './telegram/grammy-sender.js';

export interface NotificationsOptions {
  env: Pick<ServerEnv, 'REDIS_URL' | 'TELEGRAM_BOT_TOKEN' | 'MINIAPP_URL'>;
  prisma: PrismaClient;
  logger: Logger;
  /** Tests only. */
  sender?: TelegramSender;
  queuePrefix?: string;
  intervalMs?: number;
  reconcileMs?: number;
  clock?: () => Date;
  staleEnqueuedMs?: number;
  staleSendingMs?: number;
}

export interface Notifications {
  /** Stops the loops, drains the BullMQ worker, then closes the queue. */
  stop(): Promise<void>;
}

/**
 * Wires the creator-result pipeline: outbox loops -> BullMQ queue -> processor -> Telegram.
 * Returns `null` (and logs once) while the bot token or the Mini App URL is missing: events then
 * wait in the outbox until the worker restarts with the configuration.
 */
export function startNotifications(options: NotificationsOptions): Notifications | null {
  const { env, logger, prisma } = options;
  const token = env.TELEGRAM_BOT_TOKEN;
  if ((!token && !options.sender) || !env.MINIAPP_URL) {
    logger.warn(
      'notifications unconfigured: events wait in the outbox (needs bot token and Mini App URL)',
    );
    return null;
  }
  const sender = options.sender ?? createGrammySender({ token: token as string });
  const prefix = options.queuePrefix ?? 'bull';

  const queue = createNotificationQueue({ redisUrl: env.REDIS_URL, prefix });
  const notifier = new CreatorResultNotifier(prisma, sender, {
    miniAppUrl: env.MINIAPP_URL,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const consumer = createNotificationWorker({
    redisUrl: env.REDIS_URL,
    prefix,
    logger,
    handler: (eventId) => notifier.process(eventId),
  });
  const dispatcher = new OutboxDispatcher(prisma, queue, {
    handledTypes: CREATOR_RESULT_EVENT_TYPES,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.staleEnqueuedMs !== undefined ? { staleEnqueuedMs: options.staleEnqueuedMs } : {}),
    ...(options.staleSendingMs !== undefined ? { staleSendingMs: options.staleSendingMs } : {}),
  });
  const loops = startOutboxLoops({
    dispatcher,
    logger,
    ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    ...(options.reconcileMs !== undefined ? { reconcileMs: options.reconcileMs } : {}),
  });
  logger.info('notifications started');
  return {
    async stop() {
      await loops.stop();
      await consumer.close();
      await queue.close();
    },
  };
}
