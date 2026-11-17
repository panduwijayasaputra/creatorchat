import { Module } from '@nestjs/common';
import {
  AccountSecurityService,
  UserDetailService,
  UserHistoryService,
  UserListService,
  UserModerationService,
  UserRequestsService,
} from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { UsersController } from './users.controller.js';
import { USER_DETAIL, USER_HISTORY, USER_LIST, USER_MODERATION, USER_REQUESTS } from './tokens.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [UsersController],
  providers: [
    {
      provide: USER_LIST,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UserListService(prisma.client),
    },
    {
      provide: USER_DETAIL,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UserDetailService(prisma.client),
    },
    {
      provide: USER_REQUESTS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UserRequestsService(prisma.client),
    },
    {
      provide: USER_HISTORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new UserHistoryService(prisma.client),
    },
    {
      provide: USER_MODERATION,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new UserModerationService(prisma.client, new AccountSecurityService(prisma.client)),
    },
  ],
})
export class AdminUsersModule {}
