import { Module } from '@nestjs/common';
import { CreatorSettingsService, ProfileService } from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CreatorController } from './creator.controller.js';
import { CREATOR_PROFILE, CREATOR_SETTINGS } from './tokens.js';

@Module({
  imports: [AuthModule],
  controllers: [CreatorController],
  providers: [
    {
      provide: CREATOR_SETTINGS,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CreatorSettingsService(prisma.client),
    },
    {
      provide: CREATOR_PROFILE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new ProfileService(prisma.client),
    },
  ],
})
export class CreatorModule {}
