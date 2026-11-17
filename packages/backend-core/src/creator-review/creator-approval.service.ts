import type {
  AdminCreatorRequest,
  ApprovalBlock,
  CreatorType,
  RejectCreatorRequestData,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import type { AccountSecurityService, Tx } from '../account-security/account-security.service.js';
import { generatePublicCode } from '../creator-link/public-code.js';
import { findSubscriptionBlock } from '../creator-request/subscription-block.js';
import { OutboxEventType, OutboxService } from '../outbox/outbox.service.js';

export interface ReviewContext {
  /** The admin from the session; never taken from a request body. */
  adminId: string;
  requestId?: string | undefined;
}

export type ApproveOutcome =
  | { kind: 'ok'; request: AdminCreatorRequest; creator: { id: string; publicCode: string } }
  | { kind: 'not_found' }
  | { kind: 'already_reviewed'; status: 'APPROVED' | 'REJECTED' }
  | { kind: 'not_eligible' }
  | { kind: 'blocked'; block: ApprovalBlock };

export type RejectOutcome =
  | { kind: 'ok'; request: AdminCreatorRequest }
  | { kind: 'not_found' }
  | { kind: 'already_reviewed'; status: 'APPROVED' | 'REJECTED' };

export interface ReviewView {
  request: AdminCreatorRequest;
  check: { block: ApprovalBlock | null; checkedAt: Date };
}

export interface CreatorApprovalOptions {
  clock?: () => Date;
  generateCode?: () => string;
}

const MAX_CODE_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APPLICATION_SELECT = {
  id: true,
  userId: true,
  status: true,
  creatorName: true,
  instagramUrl: true,
  creatorType: true,
  description: true,
  createdAt: true,
  reviewedAt: true,
  reviewReason: true,
  user: {
    select: {
      id: true,
      displayName: true,
      telegramUsername: true,
      telegramId: true,
      role: true,
      status: true,
    },
  },
} as const;

type Row = {
  id: string;
  status: AdminCreatorRequest['status'];
  creatorName: string;
  instagramUrl: string;
  creatorType: AdminCreatorRequest['creator_type'];
  description: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewReason: string | null;
  user: {
    id: string;
    displayName: string;
    telegramUsername: string | null;
    telegramId: bigint;
    role: AdminCreatorRequest['user']['role'];
    status: AdminCreatorRequest['user']['status'];
  };
};

/** Explicit mapping: no Prisma row, reviewer id or other internal column leaves the service. */
function toAdminRequest(row: Row): AdminCreatorRequest {
  return {
    id: row.id,
    status: row.status,
    creator_name: row.creatorName,
    instagram_url: row.instagramUrl,
    creator_type: row.creatorType,
    description: row.description,
    created_at: row.createdAt.toISOString(),
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    review_reason: row.reviewReason,
    user: {
      id: row.user.id,
      display_name: row.user.displayName,
      telegram_username: row.user.telegramUsername,
      telegram_id: row.user.telegramId.toString(),
      role: row.user.role,
      status: row.user.status,
    },
  };
}

/**
 * An admin approves or rejects a creator request (US-012). Every decision is one transaction with a
 * fixed lock order (user row, then application row, the same order the submit uses), so two admins,
 * a double click and a concurrent submit serialise and exactly one decision wins. The caller passes
 * the admin id from the session; the request id is the only client-supplied identifier.
 */
export class CreatorApprovalService {
  private readonly clock: () => Date;
  private readonly generateCode: () => string;
  private readonly outbox = new OutboxService();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly security: AccountSecurityService,
    options: CreatorApprovalOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.generateCode = options.generateCode ?? (() => generatePublicCode());
  }

  /** The request, its applicant and the approval pre-check. A read: the decision re-checks. */
  async getForReview(id: string): Promise<ReviewView | null> {
    if (!UUID.test(id)) return null;
    const row = await this.prisma.creatorApplication.findUnique({
      where: { id },
      select: APPLICATION_SELECT,
    });
    if (!row) return null;
    const now = this.clock();
    return {
      request: toAdminRequest(row),
      check: { block: await findSubscriptionBlock(this.prisma, row.userId, now), checkedAt: now },
    };
  }

  async approve(id: string, context: ReviewContext): Promise<ApproveOutcome> {
    if (!UUID.test(id)) return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, id);
      if (!locked) return { kind: 'not_found' } as const;
      if (locked.application.status !== 'PENDING') {
        return { kind: 'already_reviewed', status: locked.application.status } as const;
      }
      if (locked.user.status !== 'ACTIVE' || locked.user.role !== 'USER') {
        return { kind: 'not_eligible' } as const;
      }
      const now = this.clock();
      const block = await findSubscriptionBlock(tx, locked.userId, now);
      if (block) return { kind: 'blocked', block } as const;

      const before = await tx.creatorApplication.findUniqueOrThrow({
        where: { id },
        select: APPLICATION_SELECT,
      });
      await tx.creatorApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedByAdminId: context.adminId,
          reviewedAt: now,
          reviewReason: null,
        },
      });
      // Same account: role, session_version, revoked sessions and the role audit row.
      await this.security.changeRoleInTransaction(tx, locked.userId, 'CREATOR', {
        actor: { type: 'ADMIN', id: context.adminId },
        requestId: context.requestId,
      });
      await tx.user.update({
        where: { id: locked.userId },
        data: { displayName: before.creatorName },
      });
      const creator = await this.insertCreator(
        tx,
        locked.userId,
        before.creatorType,
        before.instagramUrl,
      );
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: context.adminId,
          action: 'creator.application.approved',
          targetType: 'creator_application',
          targetId: id,
          changes: {
            user_id: locked.userId,
            creator_id: creator.id,
            public_code: creator.publicCode,
            display_name: [before.user.displayName, before.creatorName],
          },
          requestId: context.requestId ?? null,
        },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.CREATOR_APPLICATION_APPROVED,
        aggregateType: 'creator_application',
        aggregateId: id,
        payload: { application_id: id, user_id: locked.userId, decision: 'approved' },
        dedupeKey: `creator_application:${id}:decision`,
      });

      const after = await tx.creatorApplication.findUniqueOrThrow({
        where: { id },
        select: APPLICATION_SELECT,
      });
      return { kind: 'ok', request: toAdminRequest(after), creator } as const;
    });
  }

  async reject(
    id: string,
    input: RejectCreatorRequestData,
    context: ReviewContext,
  ): Promise<RejectOutcome> {
    if (!UUID.test(id)) return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, id);
      if (!locked) return { kind: 'not_found' } as const;
      if (locked.application.status !== 'PENDING') {
        return { kind: 'already_reviewed', status: locked.application.status } as const;
      }
      await tx.creatorApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedByAdminId: context.adminId,
          reviewedAt: this.clock(),
          reviewReason: input.reason,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: context.adminId,
          action: 'creator.application.rejected',
          targetType: 'creator_application',
          targetId: id,
          reason: input.reason,
          changes: { user_id: locked.userId },
          requestId: context.requestId ?? null,
        },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.CREATOR_APPLICATION_REJECTED,
        aggregateType: 'creator_application',
        aggregateId: id,
        payload: { application_id: id, user_id: locked.userId, decision: 'rejected' },
        dedupeKey: `creator_application:${id}:decision`,
      });
      const after = await tx.creatorApplication.findUniqueOrThrow({
        where: { id },
        select: APPLICATION_SELECT,
      });
      return { kind: 'ok', request: toAdminRequest(after) } as const;
    });
  }

  /**
   * Lock order: the applicant's user row first, then the application row. `submit` takes only the
   * user row, so nothing can lock them the other way round.
   */
  private async lock(tx: Tx, id: string) {
    const head = await tx.creatorApplication.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!head) return null;
    const users = await tx.$queryRaw<{ status: string; role: string }[]>`
      SELECT status::text AS status, role::text AS role FROM users
      WHERE id = ${head.userId}::uuid FOR UPDATE`;
    const applications = await tx.$queryRaw<{ status: 'PENDING' | 'APPROVED' | 'REJECTED' }[]>`
      SELECT status::text AS status FROM creator_applications
      WHERE id = ${id}::uuid FOR UPDATE`;
    const user = users[0];
    const application = applications[0];
    if (!user || !application) return null;
    return { userId: head.userId, user, application };
  }

  /**
   * A plain insert that hits a unique violation would abort the whole transaction, so the code
   * collision is handled with ON CONFLICT DO NOTHING and a bounded retry.
   */
  private async insertCreator(
    tx: Tx,
    userId: string,
    type: CreatorType,
    instagramUrl: string,
  ): Promise<{ id: string; publicCode: string }> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = this.generateCode();
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO creators (user_id, public_code, creator_type, instagram_url, updated_at)
        VALUES (${userId}::uuid, ${code}, ${type}::"CreatorType", ${instagramUrl}, now())
        ON CONFLICT (public_code) DO NOTHING
        RETURNING id::text AS id`;
      const created = rows[0];
      if (created) return { id: created.id, publicCode: code };
    }
    throw new Error('Could not generate a unique creator code.');
  }
}
