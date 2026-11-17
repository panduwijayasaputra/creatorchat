import type { AuditLogDetail } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import {
  actionKind,
  actionLabel,
  actionStatus,
  projectChanges,
  summaryOf,
} from './audit-labels.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One audit entry for the Detail Log page: allowlisted fields only, `changes` never raw. */
export class AuditLogService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(id: string): Promise<AuditLogDetail | null> {
    if (!UUID.test(id)) return null;
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) return null;
    const { before, after } = projectChanges(row.changes);
    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      actor: await this.actor(row.actorType, row.actorId),
      action: actionLabel(row.action),
      kind: actionKind(row.action),
      target: await this.target(row.targetType, row.targetId),
      status: actionStatus(row.action),
      summary: summaryOf(row.action, row.changes),
      reason: row.reason,
      request_id: row.requestId,
      before,
      after,
    };
  }

  private async actor(type: 'ADMIN' | 'USER' | 'SYSTEM', id: string | null): Promise<string> {
    if (type === 'SYSTEM' || !id) return 'Sistem';
    if (type === 'ADMIN') {
      return (
        (await this.prisma.adminAccount.findUnique({ where: { id }, select: { username: true } }))
          ?.username ?? 'Admin'
      );
    }
    return (
      (await this.prisma.user.findUnique({ where: { id }, select: { displayName: true } }))
        ?.displayName ?? 'User'
    );
  }

  private async target(type: string | null, id: string | null): Promise<string> {
    if (!type || !id || !UUID.test(id)) return type ?? '–';
    if (type === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { displayName: true, creator: { select: { id: true } } },
      });
      return user ? `${user.displayName} (${user.creator ? 'creator' : 'user'})` : 'user';
    }
    if (type === 'creator') {
      const c = await this.prisma.creator.findUnique({
        where: { id },
        select: { user: { select: { displayName: true } } },
      });
      return c ? `${c.user.displayName} (creator)` : 'creator';
    }
    if (type === 'creator_application') {
      const a = await this.prisma.creatorApplication.findUnique({
        where: { id },
        select: { creatorName: true },
      });
      return a ? `${a.creatorName} (pengajuan)` : 'pengajuan';
    }
    return type;
  }
}
