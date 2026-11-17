import { Module } from '@nestjs/common';
import {
  ConversationReadService,
  CreatorChatService,
  CreatorInboxService,
  CreatorSettingsService,
  MediaAccessService,
  OutboxService,
  type ObjectStorage,
  ProfileService,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../media/storage.module.js';
import { STORAGE } from '../media/tokens.js';
import { CreatorController } from './creator.controller.js';
import { CreatorChatController } from './creator-chat.controller.js';
import { CreatorInboxController } from './creator-inbox.controller.js';
import {
  CREATOR_CHAT,
  CREATOR_INBOX,
  CREATOR_PROFILE,
  CREATOR_READ,
  CREATOR_SETTINGS,
} from './tokens.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [CreatorController, CreatorInboxController, CreatorChatController],
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
      provide: CREATOR_PROFILE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ProfileService(prisma.client),
    },
  ],
})
export class CreatorModule {}
