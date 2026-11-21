import {
  accessActivatedHandler,
  accessReminderHandler,
  creatorResultHandler,
  messageNotificationHandler,
  NotificationRouter,
  OutboxDispatcher,
  TelegramDeliveryRunner,
  type ServerEnv,
  type TelegramSender,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import type { Logger } from 'pino';
import { startAccessScheduler } from './access-scheduler.js';
import { startOutboxLoops } from './outbox/loops.js';
import { createNotificationQueue, createNotificationWorker } from './queue/bullmq-queue.js';
import { createGrammySender } from './telegram/grammy-sender.js';

/**
 * A chat message is considered for a notification this long after it was written: a recipient who
 * has the chat open reads it meanwhile (the read cursor moves) and is not notified, and a burst of
 * messages becomes one notification (US-042).
 */
export const MESSAGE_NOTIFY_DELAY_MS = 30_000;

export interface NotificationsOptions {
  env: Pick<ServerEnv, 'REDIS_URL' | 'TELEGRAM_BOT_TOKEN' | 'MINIAPP_URL'> &
    Partial<Pick<ServerEnv, 'ACCESS_REMINDER_LEAD_DAYS'>>;
  prisma: PrismaClient;
  logger: Logger;
  /** Tests only. */
  sender?: TelegramSender;
  queuePrefix?: string;
  /** Tests only: how often the access scheduler scans. */
  schedulerIntervalMs?: number;
  /** Tests only: how long a message waits before it is considered. */
  messageDelayMs?: number;
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
 * Wires the Telegram notification pipeline (creator result, access activated and reminders, new messages): outbox loops -> BullMQ queue -> processor -> Telegram.
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
  const runner = new TelegramDeliveryRunner(prisma, sender, {
    miniAppUrl: env.MINIAPP_URL,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const router = new NotificationRouter(prisma, runner, [
    creatorResultHandler,
    accessActivatedHandler,
    messageNotificationHandler,
    accessReminderHandler,
  ]);
  const consumer = createNotificationWorker({
    redisUrl: env.REDIS_URL,
    prefix,
    logger,
    handler: (eventId) => router.process(eventId),
  });
  const dispatcher = new OutboxDispatcher(prisma, queue, {
    handledTypes: router.handledTypes,
    minAgeMs: { 'message.created': options.messageDelayMs ?? MESSAGE_NOTIFY_DELAY_MS },
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
  // The scheduler only writes outbox events; the pipeline above sends them.
  const scheduler = startAccessScheduler({
    prisma,
    logger,
    leadDays: env.ACCESS_REMINDER_LEAD_DAYS ?? 3,
    ...(options.schedulerIntervalMs !== undefined
      ? { intervalMs: options.schedulerIntervalMs }
      : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });
  logger.info('notifications started');
  return {
    async stop() {
      await scheduler.stop();
      await loops.stop();
      await consumer.close();
      await queue.close();
    },
  };
}
