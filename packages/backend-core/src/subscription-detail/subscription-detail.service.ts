import {
  daysBetweenJakarta,
  type SubscriptionDetailResponse,
  type SubscriptionEventRow,
  type SubscriptionEventSort,
  type SubscriptionEventsQuery,
  type SubscriptionEventsResponse,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTION_LABEL = {
  GRANT: 'Berikan akses',
  EXTEND: 'Perpanjang akses',
  REVOKE: 'Cabut akses',
} as const;

/** The only ORDER BY expressions that can reach the query. */
const SORT_SQL: Record<SubscriptionEventSort, string> = {
  time: 'created_at',
  actor: 'lower(actor)',
  action: "CASE type WHEN 'GRANT' THEN 0 WHEN 'EXTEND' THEN 1 ELSE 2 END",
};

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date);

interface RawEvent {
  id: string;
  type: 'GRANT' | 'EXTEND' | 'REVOKE';
  created_at: Date;
  starts_at: Date | null;
  previous_ends_at: Date | null;
  new_ends_at: Date | null;
  audit_log_id: string | null;
  actor: string;
}

function summaryOf(e: RawEvent): string {
  if (e.type === 'REVOKE') return 'Akses dicabut';
  if (e.type === 'GRANT' && e.starts_at && e.new_ends_at) {
    return `${daysBetweenJakarta(e.starts_at, e.new_ends_at)} hari`;
  }
  if (e.type === 'EXTEND' && e.previous_ends_at && e.new_ends_at) {
    return `${daysBetweenJakarta(e.previous_ends_at, e.new_ends_at)} hari (hingga ${formatDate(e.new_ends_at)})`;
  }
  return '–';
}

/**
 * One subscription of a USER and its access history (US-021). Ownership is part of every lookup:
 * another user's subscription, a creator id, an admin id and unknown ids are all `null`. Read-only;
 * the reason and the admin id of an event are never returned (the reason is on the log page).
 */
export class SubscriptionDetailService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async get(userId: string, subId: string): Promise<SubscriptionDetailResponse | null> {
    const sub = await this.owned(userId, subId);
    if (!sub) return null;
    const now = this.clock();
    const grant = await this.prisma.subscriptionEvent.findFirst({
      where: { subscriptionId: sub.id, type: 'GRANT' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { admin: { select: { username: true } } },
    });
    return {
      subscription: {
        id: sub.id,
        status: sub.revokedAt ? 'REVOKED' : sub.endsAt > now ? 'ACTIVE' : 'EXPIRED',
        starts_at: sub.startsAt.toISOString(),
        ends_at: sub.endsAt.toISOString(),
        revoked_at: sub.revokedAt?.toISOString() ?? null,
        source: 'ADMIN',
        created_by_label: grant?.admin.username ?? null,
      },
      customer: {
        id: sub.customer.id,
        display_name: sub.customer.displayName,
        telegram_username: sub.customer.telegramUsername,
        telegram_id: sub.customer.telegramId.toString(),
      },
      creator: { id: sub.creatorId, display_name: sub.creator.user.displayName },
    };
  }

  async events(
    userId: string,
    subId: string,
    query: SubscriptionEventsQuery,
  ): Promise<SubscriptionEventsResponse | null> {
    const sub = await this.owned(userId, subId);
    if (!sub) return null;
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}, created_at DESC, id`;
    const base = Prisma.sql`
      SELECT e.id::text AS id, e.type::text AS type, e.created_at, e.starts_at, e.previous_ends_at,
             e.new_ends_at, e.audit_log_id::text AS audit_log_id, a.username AS actor
      FROM subscription_events e JOIN admin_accounts a ON a.id = e.admin_id
      WHERE e.subscription_id = ${sub.id}::uuid`;
    const counted = await this.prisma.$queryRaw<{ total: number }[]>`
      WITH rows AS (${base}) SELECT count(*)::int AS total FROM rows`;
    const rows = await this.prisma.$queryRaw<RawEvent[]>`
      WITH rows AS (${base}) SELECT * FROM rows ORDER BY ${order}
      LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`;
    return {
      items: rows.map((e): SubscriptionEventRow => ({
        id: e.id,
        at: e.created_at.toISOString(),
        actor: e.actor,
        action: ACTION_LABEL[e.type],
        summary: summaryOf(e),
        status: 'success',
        log_id: e.audit_log_id,
      })),
      total: counted[0]?.total ?? 0,
      page: query.page,
      page_size: query.page_size as 10 | 25 | 50,
    };
  }

  /** The subscription of this USER (the customer filter is part of the lookup). */
  private async owned(userId: string, subId: string) {
    if (!UUID.test(userId) || !UUID.test(subId)) return null;
    return this.prisma.subscription.findFirst({
      where: { id: subId, customerId: userId, customer: { role: 'USER' } },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        revokedAt: true,
        creatorId: true,
        customer: {
          select: { id: true, displayName: true, telegramUsername: true, telegramId: true },
        },
        creator: { select: { user: { select: { displayName: true } } } },
      },
    });
  }
}
