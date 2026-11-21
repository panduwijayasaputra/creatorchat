import { Module } from '@nestjs/common';
import { NotificationPreferencesService } from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NOTIFICATION_PREFERENCES } from './tokens.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATION_PREFERENCES,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new NotificationPreferencesService(prisma.client),
    },
  ],
})
export class NotificationsModule {}
