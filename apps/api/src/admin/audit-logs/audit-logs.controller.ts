import { Controller, Get, Header, Inject, Param, UseGuards } from '@nestjs/common';
import type { AuditLogService } from '@creatorchat/backend-core';
import { ErrorCode, type AuditLogDetail } from '@creatorchat/contracts';
import { AdminJwtGuard } from '../../common/auth/admin-jwt.guard.js';
import { CsrfGuard } from '../../common/auth/csrf.guard.js';
import { AppError } from '../../common/errors/app-error.js';

export const AUDIT_LOG = Symbol('AUDIT_LOG');

/** One audit entry (US-015), allowlisted fields only. Read-only. */
@Controller('admin/audit-logs')
@UseGuards(CsrfGuard, AdminJwtGuard)
export class AuditLogsController {
  constructor(@Inject(AUDIT_LOG) private readonly audits: AuditLogService) {}

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async get(@Param('id') id: string): Promise<AuditLogDetail> {
    const result = await this.audits.get(id);
    if (!result) throw new AppError(ErrorCode.NOT_FOUND, 404, 'Log not found.');
    return result;
  }
}
