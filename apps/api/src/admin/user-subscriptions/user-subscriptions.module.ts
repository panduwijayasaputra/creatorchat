import { Module } from '@nestjs/common';
import {
  AccessRequestReviewService,
  OutboxService,
  SubscriptionAccessService,
  SubscriptionDetailService,
  SubscriptionListService,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import {
  ACCESS_REQUEST_REVIEW,
  SUBSCRIPTION_ACCESS,
  SUBSCRIPTION_DETAIL,
  SUBSCRIPTION_LIST,
} from './tokens.js';
import { UserSubscriptionsController } from './user-subscriptions.controller.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [UserSubscriptionsController],
  providers: [
    {
      provide: SUBSCRIPTION_LIST,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new SubscriptionListService(prisma.client),
    },
    {
      provide: SUBSCRIPTION_DETAIL,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new SubscriptionDetailService(prisma.client),
    },
    {
      provide: SUBSCRIPTION_ACCESS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new SubscriptionAccessService(prisma.client, new OutboxService()),
    },
    {
      provide: ACCESS_REQUEST_REVIEW,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new AccessRequestReviewService(prisma.client, new OutboxService()),
    },
  ],
})
export class AdminUserSubscriptionsModule {}
