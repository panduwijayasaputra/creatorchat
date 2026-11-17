import { Module } from '@nestjs/common';
import { AuditLogService } from '@creatorchat/backend-core';
import { PrismaService } from '../../common/infra/prisma.service.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AUDIT_LOG, AuditLogsController } from './audit-logs.controller.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AuditLogsController],
  providers: [
    {
      provide: AUDIT_LOG,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new AuditLogService(prisma.client),
    },
  ],
})
export class AdminAuditLogsModule {}
