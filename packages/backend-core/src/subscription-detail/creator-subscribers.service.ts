import {
  GRANTABLE_USERS_LIMIT,
  type CreatorSubscriberRow,
  type CreatorSubscriberSort,
  type CreatorSubscribersQuery,
  type CreatorSubscribersResponse,
  type GrantableUsersResponse,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only ORDER BY expressions that can reach the query. */
const SORT_SQL: Record<CreatorSubscriberSort, string> = {
  subscriber: 'lower(name)',
  telegram: "lower(coalesce(telegram_username, ''))",
  status: "CASE status WHEN 'ACTIVE' THEN 0 WHEN 'EXPIRED' THEN 1 ELSE 2 END",
  starts: 'starts_at',
  ends: 'ends_at',
};

interface RawRow {
  id: string;
  customer_id: string;
  name: string;
  avatar_url: string | null;
  telegram_username: string | null;
  telegram_id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  starts_at: Date;
  ends_at: Date;
  revoked_at: Date | null;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * A creator's customers (US-021): the Subscriber tab and the picker of Berikan Akses. `creatorId`
 * is a creator id only; anything else answers `null`. Read-only; search, filters, sort and paging
 * run in SQL from an already validated query.
 */
export class CreatorSubscribersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(
    creatorId: string,
    query: CreatorSubscribersQuery,
  ): Promise<CreatorSubscribersResponse | null> {
    if (!(await this.creator(creatorId))) return null;
    const now = this.clock();
    const parts: Prisma.Sql[] = [];
    if (query.status !== 'all') parts.push(Prisma.sql`status = ${query.status.toUpperCase()}`);
    if (query.ends === 'past') parts.push(Prisma.sql`ends_at <= ${now}::timestamptz`);
    if (query.ends === 'next7' || query.ends === 'next30') {
      const until = new Date(now.getTime() + (query.ends === 'next7' ? 7 : 30) * DAY_MS);
      parts.push(Prisma.sql`ends_at > ${now}::timestamptz AND ends_at <= ${until}::timestamptz`);
    }
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      parts.push(
        /^\d+$/.test(query.q)
          ? Prisma.sql`(name ILIKE ${like} OR telegram_id LIKE ${escapeLike(query.q) + '%'})`
          : Prisma.sql`name ILIKE ${like}`,
      );
    }
    const where = parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}, ends_at DESC, id`;
    const base = Prisma.sql`
      SELECT s.id::text AS id, cu.id::text AS customer_id, cu.display_name AS name, cu.avatar_url,
             cu.telegram_username, cu.telegram_id::text AS telegram_id, s.starts_at, s.ends_at,
             s.revoked_at,
             CASE WHEN s.revoked_at IS NOT NULL THEN 'REVOKED'
                  WHEN s.ends_at > ${now}::timestamptz THEN 'ACTIVE' ELSE 'EXPIRED' END AS status
      FROM subscriptions s JOIN users cu ON cu.id = s.customer_id
      WHERE s.creator_id = ${creatorId}::uuid AND cu.role = 'USER'`;

    const counted = await this.prisma.$queryRaw<{ total: number }[]>`
      WITH rows AS (${base}) SELECT count(*)::int AS total FROM rows ${where}`;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      WITH rows AS (${base}) SELECT * FROM rows ${where} ORDER BY ${order}
      LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`;
    return {
      items: rows.map((r): CreatorSubscriberRow => ({
        id: r.id,
        customer: {
          id: r.customer_id,
          display_name: r.name,
          avatar_url: https(r.avatar_url),
          telegram_username: r.telegram_username,
          telegram_id: r.telegram_id,
        },
        status: r.status,
        starts_at: r.starts_at.toISOString(),
        ends_at: r.ends_at.toISOString(),
        revoked_at: r.revoked_at?.toISOString() ?? null,
      })),
      total: counted[0]?.total ?? 0,
      page: query.page,
      page_size: query.page_size as 10 | 25 | 50,
    };
  }

  /** ACTIVE USER accounts without running access to this creator, at most 20, by name. */
  async grantableUsers(
    creatorId: string,
    q: string | null,
  ): Promise<GrantableUsersResponse | null> {
    const creator = await this.creator(creatorId);
    if (!creator) return null;
    if (creator.status !== 'ACTIVE' || creator.user.status !== 'ACTIVE') {
      return { creator_status: 'BLOCKED', items: [] };
    }
    const now = this.clock();
    const search = q
      ? /^\d+$/.test(q)
        ? Prisma.sql`AND (u.display_name ILIKE ${`%${escapeLike(q)}%`} OR u.telegram_id::text LIKE ${escapeLike(q) + '%'})`
        : Prisma.sql`AND u.display_name ILIKE ${`%${escapeLike(q)}%`}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        display_name: string;
        avatar_url: string | null;
        telegram_username: string | null;
        telegram_id: string;
      }[]
    >`
      SELECT u.id::text AS id, u.display_name, u.avatar_url, u.telegram_username,
             u.telegram_id::text AS telegram_id
      FROM users u
      WHERE u.role = 'USER' AND u.status = 'ACTIVE' ${search}
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.customer_id = u.id AND s.creator_id = ${creatorId}::uuid
            AND ${entitledSubscriptionSql(now, { ignoreAccountStatus: true })})
      ORDER BY lower(u.display_name), u.id
      LIMIT ${GRANTABLE_USERS_LIMIT}`;
    return {
      creator_status: 'ACTIVE',
      items: rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        avatar_url: https(r.avatar_url),
        telegram_username: r.telegram_username,
        telegram_id: r.telegram_id,
      })),
    };
  }

  private async creator(creatorId: string) {
    if (!UUID.test(creatorId)) return null;
    return this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { status: true, user: { select: { status: true } } },
    });
  }
}
