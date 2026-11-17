import type { PrismaClient } from '@creatorchat/db';
import type { Tx } from '../account-security/account-security.service.js';
import { isPublicCode } from '../creator-link/public-code.js';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';
import { accessStateOf, type AccessRequestKind } from './access-state.js';

export type SubmitOutcome =
  | { kind: 'created' | 'existing'; type: AccessRequestKind; requestedAt: Date }
  | { kind: 'not_found' }
  | { kind: 'already_active' }
  /** The account is no longer an ACTIVE customer (blocked or promoted since the token was issued). */
  | { kind: 'not_eligible' };

interface PendingRow {
  id: string;
  type: AccessRequestKind;
  created_at: Date;
}

/**
 * A customer asks for trial or renewal access to a creator (US-023). The caller chooses only the
 * target (a public code); the type comes from the viewer's own state. One transaction locks the
 * customer row, then the creator row (the US-020 order), so a submit serialises with a grant or a
 * block. The database's partial unique index allows one PENDING request per pair: a repeat tap or
 * a retry returns the existing row and writes nothing.
 */
export class AccessRequestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async submit(userId: string, code: string): Promise<SubmitOutcome> {
    if (!isPublicCode(code)) return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const users = await tx.$queryRaw<{ role: string; status: string }[]>`
        SELECT role::text AS role, status::text AS status FROM users
        WHERE id = ${userId}::uuid FOR UPDATE`;
      if (users[0]?.role !== 'USER' || users[0].status !== 'ACTIVE')
        return { kind: 'not_eligible' } as const;

      const creators = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id::text AS id FROM creators c JOIN users u ON u.id = c.user_id
        WHERE c.public_code = ${code} AND c.status = 'ACTIVE' AND u.status = 'ACTIVE'
        FOR UPDATE OF c`;
      const creatorId = creators[0]?.id;
      if (!creatorId) return { kind: 'not_found' } as const;

      const [subscription, pending] = await Promise.all([
        tx.subscription.findUnique({
          where: { customerId_creatorId: { customerId: userId, creatorId } },
          select: { startsAt: true, endsAt: true, revokedAt: true },
        }),
        pendingOf(tx, userId, creatorId),
      ]);
      const state = accessStateOf(
        { subscription, pending: pending && { createdAt: pending.created_at, type: pending.type } },
        now,
      );
      if (state.state === 'ACTIVE') return { kind: 'already_active' } as const;
      if (state.state === 'PENDING')
        return { kind: 'existing', type: state.type, requestedAt: state.requestedAt } as const;

      const type: AccessRequestKind = state.state === 'EXPIRED' ? 'RENEWAL' : 'TRIAL';
      const inserted = await tx.$queryRaw<PendingRow[]>`
        INSERT INTO access_requests (customer_id, creator_id, type, created_at, updated_at)
        VALUES (${userId}::uuid, ${creatorId}::uuid, ${type}::"AccessRequestType", ${now}, ${now})
        ON CONFLICT (customer_id, creator_id) WHERE status = 'PENDING' DO NOTHING
        RETURNING id::text AS id, type::text AS type, created_at`;
      const row = inserted[0];
      if (!row) {
        // Lost a race that the row lock above makes rare: return the winner's request.
        const existing = await pendingOf(tx, userId, creatorId);
        if (!existing) return { kind: 'already_active' } as const;
        return { kind: 'existing', type: existing.type, requestedAt: existing.created_at } as const;
      }

      await tx.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: userId,
          action: 'access.request.created',
          targetType: 'access_request',
          targetId: row.id,
          changes: { type, creator_id: creatorId },
        },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.ACCESS_REQUEST_CREATED,
        aggregateType: 'access_request',
        aggregateId: row.id,
        payload: { access_request_id: row.id, creator_id: creatorId, customer_id: userId, type },
        dedupeKey: `access_request:${row.id}:created`,
      });
      return { kind: 'created', type, requestedAt: row.created_at } as const;
    });
  }
}

async function pendingOf(tx: Tx, customerId: string, creatorId: string) {
  const rows = await tx.$queryRaw<PendingRow[]>`
    SELECT id::text AS id, type::text AS type, created_at FROM access_requests
    WHERE customer_id = ${customerId}::uuid AND creator_id = ${creatorId}::uuid
      AND status = 'PENDING'`;
  return rows[0] ?? null;
}
