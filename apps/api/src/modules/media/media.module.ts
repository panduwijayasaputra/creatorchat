import { Inject, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import {
  FixedWindowLimiter,
  MediaAccessService,
  MediaUploadService,
  OutboxService,
  type ObjectStorage,
  type ServerEnv,
} from '@creatorchat/backend-core';
import { MEDIA_TYPES } from '@creatorchat/contracts';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { RedisService } from '../../common/infra/redis.service.js';
import { ENV } from '../../common/infra/tokens.js';
import { AuthModule } from '../auth/auth.module.js';
import { CreatorMediaController } from './creator-media.controller.js';
import { DevStorageController } from './dev-storage.controller.js';
import { StorageModule } from './storage.module.js';
import { MEDIA_UPLOAD, STORAGE } from './tokens.js';

/** Lets the signed PUT of the local driver reach its handler as a raw stream (no buffering). */
class RawBodyForDevStorage implements OnModuleInit {
  constructor(@Inject(HttpAdapterHost) private readonly host: HttpAdapterHost) {}

  onModuleInit(): void {
    const fastify = this.host.httpAdapter.getInstance<FastifyInstance>();
    fastify.addContentTypeParser([...MEDIA_TYPES], (_request, payload, done) =>
      done(null, payload),
    );
  }
}

/**
 * Creator media endpoints (US-032) over the shared object storage. The dev-storage routes exist only
 * with the local driver outside production.
 */
@Module({})
export class MediaModule {
  static register(env: ServerEnv): DynamicModule {
    const withDevStorage = env.STORAGE_DRIVER === 'local' && env.NODE_ENV !== 'production';
    return {
      module: MediaModule,
      imports: [AuthModule, StorageModule],
      controllers: [CreatorMediaController, ...(withDevStorage ? [DevStorageController] : [])],
      providers: [
        ...(withDevStorage ? [RawBodyForDevStorage] : []),
        {
          provide: MEDIA_UPLOAD,
          inject: [ENV, STORAGE, PrismaService, RedisService],
          useFactory: (
            e: ServerEnv,
            storage: ObjectStorage | null,
            prisma: PrismaService,
            redis: RedisService,
          ) =>
            storage
              ? new MediaUploadService({
                  prisma: prisma.client,
                  storage,
                  outbox: new OutboxService(),
                  // Tests share the dev Redis, so their counters live under their own prefix.
                  limiter: new FixedWindowLimiter(
                    redis.client,
                    e.NODE_ENV === 'test' ? 'test:media:init' : 'media:init',
                  ),
                  access: new MediaAccessService(prisma.client, storage),
                  limits: {
                    photoMaxBytes: e.MEDIA_MAX_PHOTO_BYTES,
                    videoMaxBytes: e.MEDIA_MAX_VIDEO_BYTES,
                    videoMaxSeconds: e.MEDIA_MAX_VIDEO_SECONDS,
                  },
                })
              : null,
        },
      ],
      exports: [MEDIA_UPLOAD],
    };
  }
}
