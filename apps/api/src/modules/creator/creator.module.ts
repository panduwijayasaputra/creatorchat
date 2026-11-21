import { Module } from '@nestjs/common';
import {
  BroadcastService,
  ConversationReadService,
  CreatorChatService,
  CreatorInboxService,
  CreatorSettingsService,
  FixedWindowLimiter,
  MediaAccessService,
  OutboxService,
  type ObjectStorage,
  ProfileService,
  type ServerEnv,
  WelcomeMessageService,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { RedisService } from '../../common/infra/redis.service.js';
import { ENV } from '../../common/infra/tokens.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../media/storage.module.js';
import { STORAGE } from '../media/tokens.js';
import { CreatorController } from './creator.controller.js';
import { CreatorBroadcastController } from './creator-broadcast.controller.js';
import { CreatorChatController } from './creator-chat.controller.js';
import { CreatorWelcomeController } from './creator-welcome.controller.js';
import { CreatorInboxController } from './creator-inbox.controller.js';
import {
  CREATOR_BROADCAST,
  CREATOR_CHAT,
  CREATOR_INBOX,
  CREATOR_PROFILE,
  CREATOR_READ,
  CREATOR_SETTINGS,
  CREATOR_WELCOME,
} from './tokens.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    CreatorController,
    CreatorInboxController,
    CreatorChatController,
    CreatorBroadcastController,
    CreatorWelcomeController,
  ],
  providers: [
    {
      provide: CREATOR_SETTINGS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorSettingsService(prisma.client),
    },
    {
      provide: CREATOR_READ,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ConversationReadService(prisma.client, new OutboxService()),
    },
    {
      provide: CREATOR_INBOX,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorInboxService(prisma.client),
    },
    {
      provide: CREATOR_CHAT,
      inject: [PrismaService, STORAGE],
      useFactory: (prisma: PrismaService, storage: ObjectStorage | null) =>
        new CreatorChatService(
          prisma.client,
          new OutboxService(),
          undefined,
          storage ? new MediaAccessService(prisma.client, storage) : null,
        ),
    },
    {
      provide: CREATOR_BROADCAST,
      inject: [ENV, PrismaService, RedisService],
      useFactory: (env: ServerEnv, prisma: PrismaService, redis: RedisService) =>
        new BroadcastService(
          prisma.client,
          new OutboxService(),
          undefined,
          // Tests share the dev Redis, so their counters live under their own prefix.
          new FixedWindowLimiter(
            redis.client,
            env.NODE_ENV === 'test' ? 'test:broadcast:create' : 'broadcast:create',
          ),
        ),
    },
    {
      provide: CREATOR_WELCOME,
      inject: [PrismaService, STORAGE],
      useFactory: (prisma: PrismaService, storage: ObjectStorage | null) =>
        new WelcomeMessageService(
          prisma.client,
          storage ? new MediaAccessService(prisma.client, storage) : null,
        ),
    },
    {
      provide: CREATOR_PROFILE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ProfileService(prisma.client),
    },
  ],
})
export class CreatorModule {}
