import { countEntitledForCustomer } from '../subscription-access/entitlement-sql.js';
import type { UserModerationStatus } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import type { AccountSecurityService, Tx } from '../account-security/account-security.service.js';

export interface UserModerationContext {
  /** The admin from the session; never taken from a request body. */
  adminId: string;
  reason: string;
  requestId?: string | undefined;
}

type Role = 'USER' | 'CREATOR';

export type UserBlockOutcome =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'role_conflict'; role: Role }
  | { kind: 'conflict'; status: UserModerationStatus };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An admin blocks or unblocks a USER account (US-019). Each decision is one transaction that locks
 * the user row first (the first lock approval and creator moderation also take), re-checks role and
 * status, then lets `AccountSecurityService` change the account (sessions revoked, `session_version`
 * bumped, one audit row with the reason). Subscriptions, creator requests and history are never
 * touched. Creators are refused: they are moderated through `CreatorModerationService`.
 */
export class UserModerationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly security: AccountSecurityService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** A read for the dialog; the decision re-checks. Null = unknown or malformed id. */
  async getBlockCheck(userId: string) {
    if (!UUID.test(userId)) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true },
    });
    if (!user) return null;
    const now = this.clock();
    // Counted around a status change, so account statuses are not part of the number.
    const active = await countEntitledForCustomer(this.prisma, userId, now, {
      ignoreAccountStatus: true,
    });
    return {
      status: user.status as UserModerationStatus,
      role: user.role as Role,
      activeSubscriptions: active,
      checkedAt: now,
    };
  }

  block(userId: string, context: UserModerationContext): Promise<UserBlockOutcome> {
    return this.decide(userId, 'ACTIVE', context, (tx, id, ctx) =>
      this.security.blockUserInTransaction(tx, id, ctx),
    );
  }

  unblock(userId: string, context: UserModerationContext): Promise<UserBlockOutcome> {
    return this.decide(userId, 'BLOCKED', context, (tx, id, ctx) =>
      this.security.unblockUserInTransaction(tx, id, ctx),
    );
  }

  private decide(
    userId: string,
    requiredStatus: UserModerationStatus,
    context: UserModerationContext,
    apply: (
      tx: Tx,
      id: string,
      ctx: { actor: { type: 'ADMIN'; id: string }; reason: string; requestId: string | undefined },
    ) => Promise<unknown>,
  ): Promise<UserBlockOutcome> {
    if (!UUID.test(userId)) return Promise.resolve({ kind: 'not_found' });
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: UserModerationStatus; role: Role }[]>`
        SELECT status::text AS status, role::text AS role FROM users
        WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = rows[0];
      if (!user) return { kind: 'not_found' } as const;
      if (user.role !== 'USER') return { kind: 'role_conflict', role: user.role } as const;
      if (user.status !== requiredStatus) return { kind: 'conflict', status: user.status } as const;
      await apply(tx, userId, {
        actor: { type: 'ADMIN', id: context.adminId },
        reason: context.reason,
        requestId: context.requestId,
      });
      return { kind: 'ok' } as const;
    });
  }
}
