import type { UserRole } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';

/** Who caused the change. Recorded in the audit log; never a token or init data. */
export type SecurityActor =
  { type: 'SYSTEM' } | { type: 'ADMIN'; id: string } | { type: 'USER'; id: string };

export interface SecurityContext {
  actor?: SecurityActor;
  requestId?: string | undefined;
  reason?: string | undefined;
}

export type AccountChangeOutcome = { kind: 'ok'; changed: boolean } | { kind: 'not_found' };

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * The only place that changes an account's status or role. Every change bumps `session_version`
 * and revokes the user's sessions in the same transaction, so a blocked or re-roled account cannot
 * keep acting with an old session (HTTP or socket).
 */
export class AccountSecurityService {
  constructor(private readonly prisma: PrismaClient) {}

  blockUser(userId: string, context: SecurityContext = {}): Promise<AccountChangeOutcome> {
    return this.change(userId, context, 'user.account.blocked', (user) =>
      user.status === 'BLOCKED'
        ? null
        : { data: { status: 'BLOCKED' }, changes: { status: ['ACTIVE', 'BLOCKED'] } },
    );
  }

  /** Old sessions stay dead: unblocking also bumps the version, the user signs in again. */
  unblockUser(userId: string, context: SecurityContext = {}): Promise<AccountChangeOutcome> {
    return this.change(userId, context, 'user.account.unblocked', (user) =>
      user.status === 'ACTIVE'
        ? null
        : { data: { status: 'ACTIVE' }, changes: { status: ['BLOCKED', 'ACTIVE'] } },
    );
  }

  /** Does not create the `Creator` row: creator approval (Phase B) does that transactionally. */
  changeRole(
    userId: string,
    role: UserRole,
    context: SecurityContext = {},
  ): Promise<AccountChangeOutcome> {
    return this.change(userId, context, 'user.role.changed', (user) =>
      user.role === role ? null : { data: { role }, changes: { role: [user.role, role] } },
    );
  }

  private async change(
    userId: string,
    context: SecurityContext,
    action: string,
    decide: (user: { status: string; role: string }) => {
      data: { status?: 'ACTIVE' | 'BLOCKED'; role?: UserRole };
      changes: Record<string, string[]>;
    } | null,
  ): Promise<AccountChangeOutcome> {
    return this.prisma.$transaction(async (tx: Tx) => {
      // Row lock: two concurrent changes serialize and the second sees the first's result.
      const rows = await tx.$queryRaw<{ status: string; role: string }[]>`
        SELECT status::text AS status, role::text AS role FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const current = rows[0];
      if (!current) return { kind: 'not_found' } as const;
      const decision = decide(current);
      if (!decision) return { kind: 'ok', changed: false } as const;

      await tx.user.update({
        where: { id: userId },
        data: { ...decision.data, sessionVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const actor = context.actor ?? { type: 'SYSTEM' };
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.type === 'SYSTEM' ? null : actor.id,
          action,
          targetType: 'user',
          targetId: userId,
          reason: context.reason ?? null,
          changes: decision.changes,
          requestId: context.requestId ?? null,
        },
      });
      return { kind: 'ok', changed: true } as const;
    });
  }
}
