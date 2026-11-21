import { EnvError, loadEnv } from '@creatorchat/backend-core';
import { createPrismaClient } from '@creatorchat/db';
import { Redis } from 'ioredis';
import { createLogger } from './logger.js';
import { startBroadcast } from './broadcast/broadcast.js';
import { startMedia } from './media/media.js';
import { startNotifications } from './notifications.js';
import { startWelcome } from './welcome/welcome.js';
import { startRealtime } from './realtime.js';
import { createWorker } from './worker.js';

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    // EnvError lists keys only, never values.
    console.error(error instanceof EnvError ? error.message : 'Failed to load configuration');
    process.exit(1);
  }

  const logger = createLogger(env.LOG_LEVEL);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });
  redis.on('error', () => undefined); // surfaced through the dependency probe instead

  const notifications = startNotifications({ env, prisma, logger });
  const realtime = startRealtime({ env, prisma, logger });
  const media = await startMedia({ env, prisma, logger });
  const broadcast = startBroadcast({ env, prisma, logger });
  const welcome = startWelcome({ env, prisma, logger });

  const worker = createWorker({
    env,
    logger,
    pingDb: () => prisma.$queryRaw`SELECT 1`,
    pingRedis: () => redis.ping(),
    close: async () => {
      await notifications?.stop();
      await realtime.stop();
      await media?.stop();
      await broadcast.stop();
      await welcome.stop();
      redis.disconnect();
      await prisma.$disconnect();
    },
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    worker.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await worker.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'Worker failed to start');
  process.exit(1);
});
