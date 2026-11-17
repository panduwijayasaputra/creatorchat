import type { PrismaClient } from '@creatorchat/db';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';

export interface PendingAccessRequest {
  id: string;
  creator: { id: string; displayName: string };
  type: 'TRIAL' | 'RENEWAL';
  requestedAt: Date;
}

export type PendingListOutcome =
  { kind: 'ok'; items: PendingAccessRequest[] } | { kind: 'not_found' };

export type RejectAccessOutcome =
  | { kind: 'ok'; requestId: string }
  | { kind: 'not_found' }
  | { kind: 'already_reviewed'; status: 'APPROVED' | 'REJECTED' };

export interface AccessReviewContext {
  /** The admin from the session; never taken from a request body. */
  adminId: string;
  requestId?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An admin reads and rejects a customer's pending access requests (US-024). Approval is a grant
 * (`SubscriptionAccessService.grant` with the request id), so one code path decides access. A
 * rejection locks the customer's user row, then the request row, so a double click, two admins or a
 * concurrent grant act once; the loser learns the request's current status and nothing is written.
 */
export class AccessRequestReviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The user's PENDING requests, oldest first. `not_found` unless the id is a USER account. */
  async listPending(userId: string): Promise<PendingListOutcome> {
    if (!UUID.test(userId)) return { kind: 'not_found' };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'USER') return { kind: 'not_found' };
    const rows = await this.prisma.accessRequest.findMany({
      where: { customerId: userId, status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        createdAt: true,
        creator: { select: { id: true, user: { select: { displayName: true } } } },
      },
    });
    return {
      kind: 'ok',
      items: rows.map((r) => ({
        id: r.id,
        creator: { id: r.creator.id, displayName: r.creator.user.displayName },
        type: r.type,
        requestedAt: r.createdAt,
      })),
    };
  }

  async reject(
    userId: string,
    requestId: string,
    input: { reason: string },
    context: AccessReviewContext,
  ): Promise<RejectAccessOutcome> {
    if (!UUID.test(userId) || !UUID.test(requestId)) return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const users = await tx.$queryRaw<{ role: string }[]>`
        SELECT role::text AS role FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (users[0]?.role !== 'USER') return { kind: 'not_found' } as const;

      const rows = await tx.$queryRaw<
        { creator_id: string; type: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' }[]
      >`
        SELECT creator_id::text AS creator_id, type::text AS type, status::text AS status
        FROM access_requests
        WHERE id = ${requestId}::uuid AND customer_id = ${userId}::uuid FOR UPDATE`;
      const request = rows[0];
      if (!request) return { kind: 'not_found' } as const;
      if (request.status !== 'PENDING')
        return { kind: 'already_reviewed', status: request.status } as const;

      await tx.$executeRaw`
        UPDATE access_requests
        SET status = 'REJECTED', reviewed_by_admin_id = ${context.adminId}::uuid,
            reviewed_at = ${now}, review_reason = ${input.reason}, updated_at = ${now}
        WHERE id = ${requestId}::uuid`;
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: context.adminId,
          action: 'access.request.rejected',
          targetType: 'access_request',
          targetId: requestId,
          reason: input.reason,
          changes: { creator_id: request.creator_id, type: request.type },
          requestId: context.requestId ?? null,
        },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.ACCESS_REQUEST_REJECTED,
        aggregateType: 'access_request',
        aggregateId: requestId,
        payload: {
          access_request_id: requestId,
          creator_id: request.creator_id,
          customer_id: userId,
          type: request.type,
        },
        dedupeKey: `access_request:${requestId}:rejected`,
      });
      return { kind: 'ok', requestId } as const;
    });
  }
}
