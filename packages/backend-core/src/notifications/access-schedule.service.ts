import type { PrismaClient } from '@creatorchat/db';
import { Prisma } from '@creatorchat/db';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';

/** How far back an "access ended" notice is still sent, so an outage does not lose it and old history is not announced. */
export const ENDED_LOOKBACK_DAYS = 3;
const DAY = 86_400_000;
const BATCH = 500;

export interface AccessScanResult {
  /** New reminder events written (a repeated scan writes none). */
  reminders: number;
  /** New "access ended" events written. */
  ended: number;
}

interface Row {
  id: string;
  customer_id: string;
  creator_id: string;
  ends_at: Date;
}

/**
 * Decides which time-based access notices exist (US-045): a reminder for every active subscription
 * that ends within the lead time, and an "ended" notice for every subscription that ended in the last
 * few days. It only writes outbox events; the notification pipeline sends them with its retries, bot
 * handling and skip rules. The dedupe key holds the end time, so an extension (a new `ends_at`) is a
 * new period with its own reminder and ended notice, and scanning again never writes a duplicate.
 *
 * Revoked subscriptions get neither (an admin action, not an expiry), and a reminder is only ever
 * written while the access is still running, so a long outage never produces a reminder for an
 * access that already ended. Expiry itself stays purely time-based elsewhere.
 */
export class AccessScheduleService {
  private readonly leadMs: number;
  private readonly lookbackMs: number;
  private readonly clock: () => Date;
  private readonly batch: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    options: {
      leadDays: number;
      endedLookbackDays?: number;
      clock?: () => Date;
      /** Subscriptions per query (tests use a small one to exercise paging). */
      batchSize?: number;
    },
  ) {
    this.leadMs = options.leadDays * DAY;
    this.lookbackMs = (options.endedLookbackDays ?? ENDED_LOOKBACK_DAYS) * DAY;
    this.clock = options.clock ?? (() => new Date());
    this.batch = options.batchSize ?? BATCH;
  }

  async scan(now: Date = this.clock()): Promise<AccessScanResult> {
    const soon = new Date(now.getTime() + this.leadMs);
    const since = new Date(now.getTime() - this.lookbackMs);
    const reminders = await this.write(
      OutboxEventType.SUBSCRIPTION_REMINDER_DUE,
      'reminder',
      (after) => this.prisma.$queryRaw<Row[]>`
        SELECT s.id::text AS id, s.customer_id::text AS customer_id,
               s.creator_id::text AS creator_id, s.ends_at
        FROM ${ENTITLED_FROM}
        WHERE ${entitledSubscriptionSql(now)} AND s.ends_at <= ${soon}::timestamptz
          ${after}
        ORDER BY s.ends_at, s.id LIMIT ${this.batch}`,
    );
    const ended = await this.write(
      OutboxEventType.SUBSCRIPTION_ENDED,
      'ended',
      (after) => this.prisma.$queryRaw<Row[]>`
        SELECT s.id::text AS id, s.customer_id::text AS customer_id,
               s.creator_id::text AS creator_id, s.ends_at
        FROM ${ENTITLED_FROM}
        WHERE s.revoked_at IS NULL AND s.ends_at <= ${now}::timestamptz
          AND s.ends_at > ${since}::timestamptz
          AND cu.status = 'ACTIVE' AND cu.role = 'USER' AND sc.status = 'ACTIVE' AND ou.status = 'ACTIVE'
          ${after}
        ORDER BY s.ends_at, s.id LIMIT ${this.batch}`,
    );
    return { reminders, ended };
  }

  /** Pages through the matching subscriptions (keyset on end time and id) and writes one event each. */
  private async write(
    type: OutboxEventType,
    kind: 'reminder' | 'ended',
    page: (after: Prisma.Sql) => Promise<Row[]>,
  ): Promise<number> {
    let created = 0;
    let last: Row | null = null;
    for (;;) {
      const after = last
        ? Prisma.sql`AND (s.ends_at, s.id) > (${last.ends_at}::timestamptz, ${last.id}::uuid)`
        : Prisma.empty;
      const rows = await page(after);
      if (rows.length === 0) break;
      await this.prisma.$transaction(async (tx) => {
        for (const row of rows) {
          const result = await this.outbox.add(tx, {
            type,
            aggregateType: 'subscription',
            aggregateId: row.id,
            payload: {
              subscription_id: row.id,
              customer_id: row.customer_id,
              creator_id: row.creator_id,
              ends_at: row.ends_at.toISOString(),
            },
            dedupeKey: `subscription:${row.id}:ends:${row.ends_at.getTime()}:${kind}`,
          });
          if (result.created) created += 1;
        }
      });
      last = rows[rows.length - 1] ?? null;
      if (rows.length < this.batch) break;
    }
    return created;
  }
}
