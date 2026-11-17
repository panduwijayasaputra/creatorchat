import { Module } from '@nestjs/common';
import { AccountSecurityService, CreatorApprovalService } from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { CreatorRequestsController } from './creator-requests.controller.js';
import { CREATOR_APPROVAL } from './tokens.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [CreatorRequestsController],
  providers: [
    {
      provide: CREATOR_APPROVAL,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CreatorApprovalService(prisma.client, new AccountSecurityService(prisma.client)),
    },
  ],
})
export class CreatorRequestsModule {}
