import { Module } from '@nestjs/common';
import {
  AccountSecurityService,
  AdminCreatorGalleryService,
  MediaAccessService,
  type ObjectStorage,
  CreatorDetailService,
  CreatorHistoryService,
  CreatorListService,
  CreatorModerationService,
  CreatorSubscribersService,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { StorageModule } from '../../modules/media/storage.module.js';
import { STORAGE } from '../../modules/media/tokens.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { CreatorsController } from './creators.controller.js';
import {
  ADMIN_GALLERY,
  CREATOR_DETAIL,
  CREATOR_HISTORY,
  CREATOR_LIST,
  CREATOR_MODERATION,
  CREATOR_SUBSCRIBERS,
} from './tokens.js';

@Module({
  imports: [AdminAuthModule, StorageModule],
  controllers: [CreatorsController],
  providers: [
    {
      provide: CREATOR_LIST,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorListService(prisma.client),
    },
    {
      provide: CREATOR_DETAIL,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorDetailService(prisma.client),
    },
    {
      provide: CREATOR_HISTORY,
      inject: [PrismaService, CREATOR_DETAIL],
      useFactory: (prisma: PrismaService, details: CreatorDetailService) =>
        new CreatorHistoryService(prisma.client, details),
    },
    {
      provide: CREATOR_SUBSCRIBERS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorSubscribersService(prisma.client),
    },
    {
      provide: ADMIN_GALLERY,
      inject: [PrismaService, STORAGE],
      useFactory: (prisma: PrismaService, storage: ObjectStorage | null) =>
        storage
          ? new AdminCreatorGalleryService(
              prisma.client,
              new MediaAccessService(prisma.client, storage),
            )
          : null,
    },
    {
      provide: CREATOR_MODERATION,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CreatorModerationService(prisma.client, new AccountSecurityService(prisma.client)),
    },
  ],
})
export class AdminCreatorsModule {}
