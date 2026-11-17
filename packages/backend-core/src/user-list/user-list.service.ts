import type {
  UserListQuery,
  UserListResponse,
  UserListRow,
  UserListSort,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';

const DAY_MS = 86_400_000;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** The only ORDER BY expressions that can reach the query; the request picks a key, never text. */
const SORT_SQL: Record<UserListSort, string> = {
  name: 'lower(name)',
  telegram: "lower(coalesce(telegram_username, ''))",
  status: 'status',
  subscriptions: 'subs',
  request: "CASE request WHEN 'NONE' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END",
  date: 'date',
};

interface RawRow {
  id: string;
  name: string;
  avatar_url: string | null;
  telegram_username: string | null;
  telegram_id: string;
  status: 'ACTIVE' | 'BLOCKED';
  subs: number;
  pending_access: number;
  request: 'NONE' | 'PENDING' | 'REJECTED';
  date: Date;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/**
 * The admin User list (US-017): accounts with role USER, the state of their latest creator
 * request and their active subscription count. Search, filters, sort and paging are done here,
 * in SQL, from an already validated query. Read-only.
 */
export class UserListService {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async list(query: UserListQuery): Promise<UserListResponse> {
    const now = this.clock();
    const where = this.where(query, now);
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}, date DESC, id`;
    const base = this.projection(now);

    const counted = await this.prisma.$queryRaw<{ total: number }[]>`
      WITH rows AS (${base}) SELECT count(*)::int AS total FROM rows ${where}`;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      WITH rows AS (${base}) SELECT * FROM rows ${where}
      ORDER BY ${order}
      LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`;

    return {
      items: rows.map(toRow),
      total: counted[0]?.total ?? 0,
      page: query.page,
      page_size: query.page_size as 10 | 25 | 50,
    };
  }

  private projection(now: Date) {
    // A latest APPROVED application cannot exist for a USER (approval changes the role); map it to NONE.
    return Prisma.sql`
      SELECT u.id::text AS id, u.display_name AS name, u.avatar_url, u.telegram_username,
             u.telegram_id::text AS telegram_id, u.status::text AS status,
             (SELECT count(*)::int FROM ${ENTITLED_FROM}
              WHERE s.customer_id = u.id AND ${entitledSubscriptionSql(now)}) AS subs,
             (SELECT count(*)::int FROM access_requests r
              JOIN creators c ON c.id = r.creator_id
              JOIN users cu ON cu.id = c.user_id
              WHERE r.customer_id = u.id AND r.status = 'PENDING'
                AND c.status = 'ACTIVE' AND cu.status = 'ACTIVE') AS pending_access,
             CASE WHEN la.status IN ('PENDING', 'REJECTED') THEN la.status::text ELSE 'NONE' END AS request,
             u.created_at AS date
      FROM users u
      LEFT JOIN LATERAL (
        SELECT a.status FROM creator_applications a
        WHERE a.user_id = u.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1
      ) la ON true
      WHERE u.role = 'USER'`;
  }

  private where(query: UserListQuery, now: Date) {
    const parts: Prisma.Sql[] = [
      Prisma.sql`status = ANY(${query.status.map((s) => s.toUpperCase())}::text[])`,
      Prisma.sql`request = ANY(${query.request.map((s) => s.toUpperCase())}::text[])`,
    ];
    if (query.access === 'pending') parts.push(Prisma.sql`pending_access > 0`);
    if (query.range !== 'all') {
      const since = new Date(now.getTime() - RANGE_DAYS[query.range] * DAY_MS);
      parts.push(Prisma.sql`date >= ${since}::timestamptz`);
    }
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      parts.push(
        /^\d+$/.test(query.q)
          ? Prisma.sql`(name ILIKE ${like} OR telegram_id LIKE ${escapeLike(query.q) + '%'})`
          : Prisma.sql`name ILIKE ${like}`,
      );
    }
    return Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}`;
  }
}

function toRow(row: RawRow): UserListRow {
  return {
    id: row.id,
    display_name: row.name,
    avatar_url: row.avatar_url?.startsWith('https://') ? row.avatar_url : null,
    telegram_username: row.telegram_username,
    telegram_id: row.telegram_id,
    status: row.status,
    active_subscription_count: row.subs,
    creator_request_status: row.request,
    pending_access_count: row.pending_access,
    joined_at: row.date.toISOString(),
  };
}
