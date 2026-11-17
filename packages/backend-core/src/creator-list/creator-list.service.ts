import type {
  CreatorListQuery,
  CreatorListResponse,
  CreatorListRow,
  CreatorListSort,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';

const DAY_MS = 86_400_000;
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** The only ORDER BY expressions that can reach the query; the request picks a key, never text. */
const SORT_SQL: Record<CreatorListSort, string> = {
  name: 'lower(name)',
  telegram: "lower(coalesce(telegram_username, ''))",
  type: 'creator_type',
  status: 'status',
  subscribers: 'subscribers',
  date: 'date',
};

interface RawRow {
  kind: 'request' | 'creator';
  id: string;
  status: 'REQUEST' | 'ACTIVE' | 'BLOCKED';
  name: string;
  avatar_url: string | null;
  telegram_username: string | null;
  telegram_id: string;
  instagram_url: string | null;
  creator_type: 'HUMAN' | 'AI_CHARACTER';
  subscribers: number | null;
  has_sub: boolean;
  date: Date;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/**
 * The admin Creator list (US-014): pending creator requests (applicants are still USERs) plus
 * creator accounts, as one projection. Approved and rejected applications are never rows. Search,
 * filters, sort and paging are done here, in SQL, from an already validated query.
 */
export class CreatorListService {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async list(query: CreatorListQuery): Promise<CreatorListResponse> {
    const now = this.clock();
    const where = this.where(query, now);
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    // Requests have no subscriber count: they sort last in both directions.
    const nulls = Prisma.raw(query.sort === 'subscribers' ? ' NULLS LAST' : '');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}${nulls}, date DESC, id`;
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
    return Prisma.sql`
      SELECT 'request'::text AS kind, a.id::text AS id, 'REQUEST'::text AS status,
             a.creator_name AS name, u.avatar_url, u.telegram_username,
             u.telegram_id::text AS telegram_id, a.instagram_url,
             a.creator_type::text AS creator_type, NULL::int AS subscribers,
             EXISTS (SELECT 1 FROM subscriptions s
                     WHERE s.customer_id = u.id AND s.revoked_at IS NULL
                       AND s.ends_at > ${now}::timestamptz) AS has_sub,
             a.created_at AS date
      FROM creator_applications a JOIN users u ON u.id = a.user_id
      WHERE a.status = 'PENDING' AND u.role = 'USER'
      UNION ALL
      SELECT 'creator'::text, c.id::text, c.status::text, u.display_name, u.avatar_url,
             u.telegram_username, u.telegram_id::text, c.instagram_url, c.creator_type::text,
             (SELECT count(*)::int FROM ${ENTITLED_FROM}
              WHERE s.creator_id = c.id AND ${entitledSubscriptionSql(now)}),
             false, c.created_at
      FROM creators c JOIN users u ON u.id = c.user_id`;
  }

  private where(query: CreatorListQuery, now: Date) {
    const parts: Prisma.Sql[] = [
      Prisma.sql`status = ANY(${query.status.map((s) => s.toUpperCase())}::text[])`,
    ];
    if (query.type !== 'all') {
      parts.push(Prisma.sql`creator_type = ${query.type.toUpperCase()}`);
    }
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

function toRow(row: RawRow): CreatorListRow {
  return {
    kind: row.kind,
    id: row.id,
    status: row.status,
    creator_name: row.name,
    avatar_url: row.avatar_url?.startsWith('https://') ? row.avatar_url : null,
    telegram_username: row.telegram_username,
    telegram_id: row.telegram_id,
    instagram_url: row.instagram_url,
    creator_type: row.creator_type,
    subscriber_count: row.subscribers,
    has_active_subscription: row.has_sub,
    date: row.date.toISOString(),
  };
}
