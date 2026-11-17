import { Module } from '@nestjs/common';
import {
  AccessRequestService,
  CreatorAccessService,
  CustomerGalleryService,
  MediaAccessService,
  OutboxService,
  type ObjectStorage,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../media/storage.module.js';
import { STORAGE } from '../media/tokens.js';
import { CreatorsController } from './creators.controller.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { ACCESS_REQUESTS, CREATOR_ACCESS, CUSTOMER_GALLERY } from './tokens.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [CreatorsController, SubscriptionsController],
  providers: [
    {
      provide: CREATOR_ACCESS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorAccessService(prisma.client),
    },
    {
      provide: CUSTOMER_GALLERY,
      inject: [PrismaService, STORAGE],
      useFactory: (prisma: PrismaService, storage: ObjectStorage | null) =>
        storage
          ? new CustomerGalleryService(
              prisma.client,
              new MediaAccessService(prisma.client, storage),
            )
          : null,
    },
    {
      provide: ACCESS_REQUESTS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new AccessRequestService(prisma.client, new OutboxService()),
    },
  ],
})
export class CreatorsModule {}
