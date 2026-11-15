import { Module } from '@nestjs/common';
import { CreatorLinkService } from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CreatorsController } from './creators.controller.js';
import { CREATOR_LINKS } from './tokens.js';

@Module({
  imports: [AuthModule],
  controllers: [CreatorsController],
  providers: [
    {
      provide: CREATOR_LINKS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorLinkService(prisma.client),
    },
  ],
})
export class CreatorsModule {}
