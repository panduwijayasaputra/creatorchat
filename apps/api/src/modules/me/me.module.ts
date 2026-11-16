import { Module } from '@nestjs/common';
import { CreatorRequestService, ProfileService } from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CreatorRequestController } from './creator-request.controller.js';
import { MeController } from './me.controller.js';
import { CREATOR_REQUEST, PROFILE } from './tokens.js';

@Module({
  imports: [AuthModule],
  controllers: [MeController, CreatorRequestController],
  providers: [
    {
      provide: PROFILE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ProfileService(prisma.client),
    },
    {
      provide: CREATOR_REQUEST,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorRequestService(prisma.client),
    },
  ],
})
export class MeModule {}
