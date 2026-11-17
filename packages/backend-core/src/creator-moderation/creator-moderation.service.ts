import type { CreatorModerationStatus } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import type { AccountSecurityService, Tx } from '../account-security/account-security.service.js';
import { countEntitledSubscribers } from '../subscription-access/entitlement-sql.js';

export interface ModerationContext {
  /** The admin from the session; never taken from a request body. */
  adminId: string;
  reason: string;
  requestId?: string | undefined;
}

export type BlockOutcome =
  | { kind: 'ok'; activeSubscribers: number }
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: CreatorModerationStatus };

export type UnblockOutcome =
  { kind: 'ok' } | { kind: 'not_found' } | { kind: 'conflict'; status: CreatorModerationStatus };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Active = not revoked and running now (the same rule as the admin list's subscriber count). */
function countActive(db: Pick<Tx, '$queryRaw'>, creatorId: string, now: Date) {
  // The count is taken around a status change, so account statuses are not part of it.
  return countEntitledSubscribers(db, creatorId, now, { ignoreAccountStatus: true });
}

/**
 * An admin blocks or unblocks a creator (US-016). Each decision is one transaction with the same
 * lock order as creator approval (user row, then creator row), so two admins or a double click
 * serialise and the loser gets a conflict. The account change goes through
 * `AccountSecurityService` (sessions revoked, `session_version` bumped). Subscriptions, messages
 * and history are never touched, and unblocking grants nothing.
 */
export class CreatorModerationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly security: AccountSecurityService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** A read for the dialog; the decision re-checks. Null = unknown or malformed id. */
  async getBlockCheck(creatorId: string) {
    if (!UUID.test(creatorId)) return null;
    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { status: true },
    });
    if (!creator) return null;
    const now = this.clock();
    return {
      status: creator.status as CreatorModerationStatus,
      activeSubscribers: await countActive(this.prisma, creatorId, now),
      checkedAt: now,
    };
  }

  block(creatorId: string, context: ModerationContext): Promise<BlockOutcome> {
    if (!UUID.test(creatorId)) return Promise.resolve({ kind: 'not_found' });
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, creatorId);
      if (!locked) return { kind: 'not_found' } as const;
      if (locked.status !== 'ACTIVE') return { kind: 'conflict', status: locked.status } as const;

      const activeSubscribers = await countActive(tx, creatorId, this.clock());
      await tx.creator.update({ where: { id: creatorId }, data: { status: 'BLOCKED' } });
      await this.security.blockUserInTransaction(tx, locked.userId, this.securityContext(context));
      await this.audit(tx, 'creator.blocked', creatorId, locked.userId, context, {
        status: ['ACTIVE', 'BLOCKED'],
        active_subscribers: activeSubscribers,
      });
      return { kind: 'ok', activeSubscribers } as const;
    });
  }

  unblock(creatorId: string, context: ModerationContext): Promise<UnblockOutcome> {
    if (!UUID.test(creatorId)) return Promise.resolve({ kind: 'not_found' });
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, creatorId);
      if (!locked) return { kind: 'not_found' } as const;
      if (locked.status !== 'BLOCKED') return { kind: 'conflict', status: locked.status } as const;

      await tx.creator.update({ where: { id: creatorId }, data: { status: 'ACTIVE' } });
      await this.security.unblockUserInTransaction(
        tx,
        locked.userId,
        this.securityContext(context),
      );
      await this.audit(tx, 'creator.unblocked', creatorId, locked.userId, context, {
        status: ['BLOCKED', 'ACTIVE'],
      });
      return { kind: 'ok' } as const;
    });
  }

  private securityContext(context: ModerationContext) {
    return {
      actor: { type: 'ADMIN' as const, id: context.adminId },
      reason: context.reason,
      requestId: context.requestId,
    };
  }

  /** User row first, then the creator row: the order creator approval uses. */
  private async lock(tx: Tx, creatorId: string) {
    const owner = await tx.creator.findUnique({
      where: { id: creatorId },
      select: { userId: true },
    });
    if (!owner) return null;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.userId}::uuid FOR UPDATE`;
    const rows = await tx.$queryRaw<{ status: CreatorModerationStatus }[]>`
      SELECT status::text AS status FROM creators WHERE id = ${creatorId}::uuid FOR UPDATE`;
    const row = rows[0];
    return row ? { userId: owner.userId, status: row.status } : null;
  }

  private audit(
    tx: Tx,
    action: string,
    creatorId: string,
    userId: string,
    context: ModerationContext,
    changes: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: context.adminId,
        action,
        targetType: 'creator',
        targetId: creatorId,
        reason: context.reason,
        changes: { user_id: userId, ...changes } as never,
        requestId: context.requestId ?? null,
      },
    });
  }
}
