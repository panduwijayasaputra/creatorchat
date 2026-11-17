import {
  createObjectStorage,
  FixedWindowLimiter,
  MediaAccessService,
  MediaUploadService,
  OutboxDispatcher,
  OutboxService,
  type ObjectStorage,
  type ServerEnv,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { startOutboxLoops } from '../outbox/loops.js';
import {
  createNotificationQueue,
  createNotificationWorker,
  MEDIA_QUEUE,
} from '../queue/bullmq-queue.js';
import { ffprobeAvailable } from './ffmpeg.js';
import { MediaEventHandler } from './media-events.js';
import { MediaProcessor } from './media-processor.js';

export interface MediaOptions {
  env: Pick<
    ServerEnv,
    | 'REDIS_URL'
    | 'STORAGE_DRIVER'
    | 'STORAGE_LOCAL_DIR'
    | 'STORAGE_LOCAL_SIGNING_SECRET'
    | 'API_PUBLIC_URL'
    | 'API_PORT'
    | 'R2_ACCOUNT_ENDPOINT'
    | 'R2_BUCKET'
    | 'R2_ACCESS_KEY_ID'
    | 'R2_SECRET_ACCESS_KEY'
    | 'MEDIA_MAX_PHOTO_BYTES'
    | 'MEDIA_MAX_VIDEO_BYTES'
    | 'MEDIA_MAX_VIDEO_SECONDS'
    | 'FFMPEG_PATH'
    | 'FFPROBE_PATH'
  >;
  prisma: PrismaClient;
  logger: Logger;
  /** Tests only. */
  storage?: ObjectStorage;
  queuePrefix?: string;
  intervalMs?: number;
  reconcileMs?: number;
  cleanupMs?: number;
  staleEnqueuedMs?: number;
}

export interface Media {
  stop(): Promise<void>;
}

/**
 * Wires the media pipeline: outbox loop -> `media` queue -> processor (verify, clean, thumbnail,
 * commit), plus the cleanup of abandoned uploads. Returns `null` (and logs once) while storage is
 * not configured or ffprobe is missing: uploaded files then wait until the worker restarts.
 */
export async function startMedia(options: MediaOptions): Promise<Media | null> {
  const { env, logger, prisma } = options;
  const storage = options.storage ?? createObjectStorage(env);
  if (!storage) {
    logger.warn('media unconfigured: uploads wait (needs the storage driver settings)');
    return null;
  }
  const ffmpeg = { ffmpeg: env.FFMPEG_PATH, ffprobe: env.FFPROBE_PATH };
  if (!(await ffprobeAvailable(ffmpeg))) {
    logger.warn('media unavailable: ffprobe was not found (brew install ffmpeg); uploads wait');
    return null;
  }

  // The limiter is only used by the API's `init`; the worker never calls it.
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', () => undefined);
  const uploads = new MediaUploadService({
    prisma,
    storage,
    outbox: new OutboxService(),
    limiter: new FixedWindowLimiter(redis, 'media:init'),
    access: new MediaAccessService(prisma, storage),
    limits: {
      photoMaxBytes: env.MEDIA_MAX_PHOTO_BYTES,
      videoMaxBytes: env.MEDIA_MAX_VIDEO_BYTES,
      videoMaxSeconds: env.MEDIA_MAX_VIDEO_SECONDS,
    },
  });
  const handler = new MediaEventHandler(
    prisma,
    new MediaProcessor({
      prisma,
      storage,
      uploads,
      ffmpeg,
      maxVideoSeconds: env.MEDIA_MAX_VIDEO_SECONDS,
    }),
    uploads,
  );

  const prefix = options.queuePrefix ?? 'bull';
  const queue = createNotificationQueue({ redisUrl: env.REDIS_URL, prefix, name: MEDIA_QUEUE });
  const consumer = createNotificationWorker({
    redisUrl: env.REDIS_URL,
    prefix,
    name: MEDIA_QUEUE,
    logger,
    concurrency: 2,
    handler: (eventId) => handler.process(eventId),
  });
  const dispatcher = new OutboxDispatcher(prisma, queue, {
    handledTypes: ['media.uploaded'],
    // A large video can take a while: do not re-enqueue it under a running job too early.
    staleEnqueuedMs: options.staleEnqueuedMs ?? 10 * 60_000,
  });
  const loops = startOutboxLoops({
    dispatcher,
    logger,
    ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    ...(options.reconcileMs !== undefined ? { reconcileMs: options.reconcileMs } : {}),
  });

  let cleaning = false;
  const cleanup = setInterval(
    () => {
      if (cleaning) return;
      cleaning = true;
      uploads
        .cleanup()
        .then((n) => {
          if (n > 0) logger.info({ removed: n }, 'media cleanup');
        })
        .catch((error: unknown) =>
          logger.error(
            { error: error instanceof Error ? error.name : 'Error' },
            'media cleanup failed',
          ),
        )
        .finally(() => {
          cleaning = false;
        });
    },
    options.cleanupMs ?? 10 * 60_000,
  );

  logger.info('media started');
  return {
    async stop() {
      clearInterval(cleanup);
      await loops.stop();
      await consumer.close();
      await queue.close();
      redis.disconnect();
    },
  };
}
