import {
  computeEndDate,
  computeExtendedEnd,
  endOfJakartaDay,
  jakartaDateString,
  MAX_END_DAYS,
  type SubscriptionStatus,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import type { Tx } from '../account-security/account-security.service.js';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';

export interface AccessContext {
  /** The admin from the session; never taken from a request body. */
  adminId: string;
  reason: string;
  requestId?: string | undefined;
}

export interface SubscriptionState {
  id: string;
  creatorId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date;
  revokedAt: Date | null;
}

export type AccessOutcome =
  | { kind: 'ok'; subscription: SubscriptionState }
  | { kind: 'not_found' }
  | { kind: 'user_role_conflict'; role: 'USER' | 'CREATOR' }
  | { kind: 'user_status_conflict'; status: 'ACTIVE' | 'BLOCKED' }
  | { kind: 'creator_not_active' }
  | { kind: 'subscription_active' }
  | { kind: 'subscription_revoked' }
  | { kind: 'subscription_not_active' }
  /** The request the grant answers is no longer PENDING (US-024). */
  | { kind: 'request_reviewed'; status: 'APPROVED' | 'REJECTED' }
  | { kind: 'invalid'; message: string };

export interface GrantInput {
  creatorId: string;
  durationDays?: number | undefined;
  /** `YYYY-MM-DD` in the admin zone; used instead of a duration. */
  endDate?: string | undefined;
  /** The pending request this grant answers (US-024): the customer's, for `creatorId`. */
  accessRequestId?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

interface SubRow {
  id: string;
  creator_id: string;
  starts_at: Date;
  ends_at: Date;
  revoked_at: Date | null;
}

const statusOf = (
  row: { ends_at: Date; revoked_at: Date | null },
  now: Date,
): SubscriptionStatus => (row.revoked_at ? 'REVOKED' : row.ends_at > now ? 'ACTIVE' : 'EXPIRED');

const stateOf = (row: SubRow, now: Date): SubscriptionState => ({
  id: row.id,
  creatorId: row.creator_id,
  status: statusOf(row, now),
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  revokedAt: row.revoked_at,
});

/**
 * An admin grants, extends or revokes a customer's access to a creator (US-020). Each action is one
 * transaction with a fixed lock order (customer's user row, creator row for a grant, then the
 * subscription row), so two admins or a double click serialise and the loser gets a conflict with
 * nothing written. Every action appends a `SubscriptionEvent`, an audit row and an outbox event
 * (ids and dates only, never the reason). Messages and conversations are never deleted.
 */
export class SubscriptionAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async grant(userId: string, input: GrantInput, context: AccessContext): Promise<AccessOutcome> {
    if (!UUID.test(userId) || !UUID.test(input.creatorId)) return { kind: 'not_found' };
    if (input.accessRequestId !== undefined && !UUID.test(input.accessRequestId))
      return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const user = await lockUser(tx, userId);
      if (!user) return { kind: 'not_found' } as const;
      if (user.role !== 'USER') return { kind: 'user_role_conflict', role: user.role } as const;
      if (user.status !== 'ACTIVE')
        return { kind: 'user_status_conflict', status: user.status } as const;

      const creators = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM creators WHERE id = ${input.creatorId}::uuid FOR UPDATE`;
      if (!creators[0]) return { kind: 'not_found' } as const;
      if (creators[0].status !== 'ACTIVE') return { kind: 'creator_not_active' } as const;

      // Lock order: customer, creator, access request, subscription.
      if (input.accessRequestId !== undefined) {
        const request = await lockRequest(tx, input.accessRequestId);
        if (!request || request.customer_id !== userId || request.creator_id !== input.creatorId)
          return { kind: 'not_found' } as const;
        if (request.status !== 'PENDING')
          return { kind: 'request_reviewed', status: request.status } as const;
      }

      const ends = this.resolveEnd(input, now);
      if (!ends.ok) return { kind: 'invalid', message: ends.message } as const;

      // A new pair is inserted; an existing one is locked below. The unique pair makes two racing
      // first grants safe: the second INSERT waits, then does nothing.
      const inserted = await tx.$queryRaw<SubRow[]>`
        INSERT INTO subscriptions (customer_id, creator_id, starts_at, ends_at, updated_at)
        VALUES (${userId}::uuid, ${input.creatorId}::uuid, ${now}, ${ends.at}, ${now})
        ON CONFLICT (customer_id, creator_id) DO NOTHING
        RETURNING id::text AS id, creator_id::text AS creator_id, starts_at, ends_at, revoked_at`;
      let row = inserted[0];
      let previous: Pick<SubRow, 'ends_at' | 'revoked_at'> | null = null;
      if (!row) {
        const existing = await tx.$queryRaw<SubRow[]>`
          SELECT id::text AS id, creator_id::text AS creator_id, starts_at, ends_at, revoked_at
          FROM subscriptions
          WHERE customer_id = ${userId}::uuid AND creator_id = ${input.creatorId}::uuid
          FOR UPDATE`;
        const current = existing[0];
        if (!current) return { kind: 'not_found' } as const;
        if (statusOf(current, now) === 'ACTIVE') return { kind: 'subscription_active' } as const;
        previous = { ends_at: current.ends_at, revoked_at: current.revoked_at };
        const updated = await tx.$queryRaw<SubRow[]>`
          UPDATE subscriptions
          SET starts_at = ${now}, ends_at = ${ends.at}, revoked_at = NULL, updated_at = ${now}
          WHERE id = ${current.id}::uuid
          RETURNING id::text AS id, creator_id::text AS creator_id, starts_at, ends_at, revoked_at`;
        row = updated[0] as SubRow;
      }

      await tx.$executeRaw`
        INSERT INTO conversations (customer_id, creator_id, updated_at)
        VALUES (${userId}::uuid, ${input.creatorId}::uuid, ${now})
        ON CONFLICT (customer_id, creator_id) DO NOTHING`;

      const eventId = await this.record(tx, 'GRANT', userId, row, context, {
        startsAt: row.starts_at,
        previousEndsAt: previous?.ends_at ?? null,
        newEndsAt: row.ends_at,
        previousRevokedAt: previous?.revoked_at ?? null,
      });
      await closePendingRequest(
        tx,
        { userId, creatorId: input.creatorId, eventId, now, adminId: context.adminId },
        input.accessRequestId ? 'request' : 'direct',
        context.requestId,
      );
      return { kind: 'ok', subscription: stateOf(row, now) } as const;
    });
  }

  async extend(
    userId: string,
    subscriptionId: string,
    input: { durationDays: number },
    context: AccessContext,
  ): Promise<AccessOutcome> {
    if (!UUID.test(userId) || !UUID.test(subscriptionId)) return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const row = await lockOwned(tx, userId, subscriptionId);
      if (!row) return { kind: 'not_found' } as const;
      if (row.revoked_at) return { kind: 'subscription_revoked' } as const;
      const newEnd = computeExtendedEnd(row.ends_at, now, input.durationDays);
      const updated = await tx.$queryRaw<SubRow[]>`
        UPDATE subscriptions SET ends_at = ${newEnd}, updated_at = ${now}
        WHERE id = ${row.id}::uuid
        RETURNING id::text AS id, creator_id::text AS creator_id, starts_at, ends_at, revoked_at`;
      const next = updated[0] as SubRow;
      const eventId = await this.record(tx, 'EXTEND', userId, next, context, {
        startsAt: null,
        previousEndsAt: row.ends_at,
        newEndsAt: next.ends_at,
        previousRevokedAt: null,
      });
      // An extended expired access is running again: a renewal request waiting for it is answered.
      if (next.ends_at > now)
        await closePendingRequest(
          tx,
          { userId, creatorId: next.creator_id, eventId, now, adminId: context.adminId },
          'direct',
          context.requestId,
        );
      return { kind: 'ok', subscription: stateOf(next, now) } as const;
    });
  }

  async revoke(
    userId: string,
    subscriptionId: string,
    context: AccessContext,
  ): Promise<AccessOutcome> {
    if (!UUID.test(userId) || !UUID.test(subscriptionId)) return { kind: 'not_found' };
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const row = await lockOwned(tx, userId, subscriptionId);
      if (!row) return { kind: 'not_found' } as const;
      if (statusOf(row, now) !== 'ACTIVE') return { kind: 'subscription_not_active' } as const;
      // `ends_at` is kept so the row still shows the original end.
      const updated = await tx.$queryRaw<SubRow[]>`
        UPDATE subscriptions SET revoked_at = ${now}, updated_at = ${now}
        WHERE id = ${row.id}::uuid
        RETURNING id::text AS id, creator_id::text AS creator_id, starts_at, ends_at, revoked_at`;
      const next = updated[0] as SubRow;
      await this.record(tx, 'REVOKE', userId, next, context, {
        startsAt: null,
        previousEndsAt: row.ends_at,
        newEndsAt: next.ends_at,
        previousRevokedAt: null,
      });
      return { kind: 'ok', subscription: stateOf(next, now) } as const;
    });
  }

  private resolveEnd(
    input: GrantInput,
    now: Date,
  ): { ok: true; at: Date } | { ok: false; message: string } {
    if ((input.durationDays === undefined) === (input.endDate === undefined))
      return { ok: false, message: 'Pilih durasi atau tanggal berakhir.' };
    if (input.durationDays !== undefined)
      return { ok: true, at: computeEndDate(now, input.durationDays) };
    const at = endOfJakartaDay(input.endDate as string);
    if (!at) return { ok: false, message: 'Tanggal tidak valid.' };
    const date = input.endDate as string;
    if (date <= jakartaDateString(now))
      return { ok: false, message: 'Tanggal berakhir harus setelah hari ini.' };
    if (date > jakartaDateString(new Date(now.getTime() + MAX_END_DAYS * DAY)))
      return {
        ok: false,
        message: `Tanggal berakhir maksimal ${MAX_END_DAYS} hari dari sekarang.`,
      };
    return { ok: true, at };
  }

  /** Event, audit and outbox rows of one action, in the action's transaction. */
  private async record(
    tx: Tx,
    type: 'GRANT' | 'EXTEND' | 'REVOKE',
    userId: string,
    row: SubRow,
    context: AccessContext,
    dates: {
      startsAt: Date | null;
      previousEndsAt: Date | null;
      newEndsAt: Date;
      previousRevokedAt: Date | null;
    },
  ): Promise<string> {
    // The audit entry first: the events table is append-only, so its id is stored with the event.
    const audit = await tx.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: context.adminId,
        action: `subscription.${{ GRANT: 'granted', EXTEND: 'extended', REVOKE: 'revoked' }[type]}`,
        targetType: 'subscription',
        targetId: row.id,
        reason: context.reason,
        changes: {
          customer_id: userId,
          creator_id: row.creator_id,
          starts_at: dates.startsAt?.toISOString() ?? null,
          previous_ends_at: dates.previousEndsAt?.toISOString() ?? null,
          ends_at: dates.newEndsAt.toISOString(),
          previous_revoked_at: dates.previousRevokedAt?.toISOString() ?? null,
          revoked_at: row.revoked_at?.toISOString() ?? null,
        },
        requestId: context.requestId ?? null,
      },
      select: { id: true },
    });
    const event = await tx.subscriptionEvent.create({
      data: {
        subscriptionId: row.id,
        type,
        adminId: context.adminId,
        reason: context.reason,
        auditLogId: audit.id,
        startsAt: dates.startsAt,
        previousEndsAt: dates.previousEndsAt,
        newEndsAt: dates.newEndsAt,
      },
      select: { id: true },
    });
    await this.outbox.add(tx, {
      type: eventType(type),
      aggregateType: 'subscription',
      aggregateId: row.id,
      payload: {
        event_id: event.id,
        subscription_id: row.id,
        customer_id: userId,
        creator_id: row.creator_id,
        ends_at: dates.newEndsAt.toISOString(),
      },
      dedupeKey: `subscription_event:${event.id}`,
    });
    return event.id;
  }
}

function eventType(type: 'GRANT' | 'EXTEND' | 'REVOKE'): OutboxEventType {
  return {
    GRANT: OutboxEventType.SUBSCRIPTION_GRANTED,
    EXTEND: OutboxEventType.SUBSCRIPTION_EXTENDED,
    REVOKE: OutboxEventType.SUBSCRIPTION_REVOKED,
  }[type];
}

async function lockRequest(tx: Tx, requestId: string) {
  const rows = await tx.$queryRaw<
    {
      customer_id: string;
      creator_id: string;
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
    }[]
  >`
    SELECT customer_id::text AS customer_id, creator_id::text AS creator_id, status::text AS status
    FROM access_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Closes the customer's PENDING request for this creator as APPROVED, linked to the access event, in
 * the access change's own transaction (US-024). At most one row exists (partial unique index).
 */
async function closePendingRequest(
  tx: Tx,
  at: { userId: string; creatorId: string; eventId: string; now: Date; adminId: string },
  via: 'request' | 'direct',
  requestId: string | undefined,
): Promise<void> {
  const closed = await tx.$queryRaw<{ id: string }[]>`
    UPDATE access_requests
    SET status = 'APPROVED', reviewed_by_admin_id = ${at.adminId}::uuid, reviewed_at = ${at.now},
        subscription_event_id = ${at.eventId}::uuid, updated_at = ${at.now}
    WHERE customer_id = ${at.userId}::uuid AND creator_id = ${at.creatorId}::uuid
      AND status = 'PENDING'
    RETURNING id::text AS id`;
  for (const row of closed) {
    await tx.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: at.adminId,
        action: 'access.request.approved',
        targetType: 'access_request',
        targetId: row.id,
        changes: { subscription_event_id: at.eventId, via },
        requestId: requestId ?? null,
      },
    });
  }
}

async function lockUser(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ role: 'USER' | 'CREATOR'; status: 'ACTIVE' | 'BLOCKED' }[]>`
    SELECT role::text AS role, status::text AS status FROM users
    WHERE id = ${userId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** The customer's row first, then the subscription, which must belong to that customer. */
async function lockOwned(tx: Tx, userId: string, subscriptionId: string): Promise<SubRow | null> {
  if (!(await lockUser(tx, userId))) return null;
  const rows = await tx.$queryRaw<SubRow[]>`
    SELECT id::text AS id, creator_id::text AS creator_id, starts_at, ends_at, revoked_at
    FROM subscriptions
    WHERE id = ${subscriptionId}::uuid AND customer_id = ${userId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}
