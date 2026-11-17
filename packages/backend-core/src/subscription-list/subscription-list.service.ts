import type {
  GrantableCreatorsResponse,
  SubscriptionListQuery,
  SubscriptionListResponse,
  SubscriptionRow,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only ORDER BY expressions that can reach the query; the request picks a key, never text. */
const SORT_SQL: Record<SubscriptionListQuery['sort'], string> = {
  creator: 'lower(creator_name)',
  status: "CASE status WHEN 'ACTIVE' THEN 0 WHEN 'EXPIRED' THEN 1 ELSE 2 END",
  starts: 'starts_at',
  ends: 'ends_at',
};

interface RawRow {
  id: string;
  creator_id: string;
  creator_name: string;
  avatar_url: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  starts_at: Date;
  ends_at: Date;
  revoked_at: Date | null;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * The Langganan tab of a user (US-020): that user's subscriptions with the creator, a derived
 * status, and the creators an admin can still grant access to. Search, filters, sort and paging run
 * in SQL from an already validated query. Read-only; unknown or non-USER ids answer null.
 */
export class SubscriptionListService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(
    userId: string,
    query: SubscriptionListQuery,
  ): Promise<SubscriptionListResponse | null> {
    if (!(await this.isUser(userId))) return null;
    const now = this.clock();
    const where = this.where(query, now);
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}, ends_at DESC, id`;
    const base = Prisma.sql`
      SELECT s.id::text AS id, s.creator_id::text AS creator_id, cu.display_name AS creator_name,
             cu.avatar_url, s.starts_at, s.ends_at, s.revoked_at,
             CASE WHEN s.revoked_at IS NOT NULL THEN 'REVOKED'
                  WHEN s.ends_at > ${now}::timestamptz THEN 'ACTIVE' ELSE 'EXPIRED' END AS status
      FROM subscriptions s
      JOIN creators c ON c.id = s.creator_id
      JOIN users cu ON cu.id = c.user_id
      WHERE s.customer_id = ${userId}::uuid`;

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

  /** ACTIVE creators this user has no running access to (expired and revoked pairs included). */
  async grantableCreators(userId: string): Promise<GrantableCreatorsResponse | null> {
    if (!(await this.isUser(userId))) return null;
    const now = this.clock();
    const rows = await this.prisma.$queryRaw<
      { id: string; display_name: string; avatar_url: string | null }[]
    >`
      SELECT c.id::text AS id, cu.display_name, cu.avatar_url
      FROM creators c
      JOIN users cu ON cu.id = c.user_id
      WHERE c.status = 'ACTIVE' AND cu.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.customer_id = ${userId}::uuid AND s.creator_id = c.id
            AND s.revoked_at IS NULL AND s.ends_at > ${now}::timestamptz)
      ORDER BY lower(cu.display_name), c.id`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        avatar_url: https(r.avatar_url),
      })),
    };
  }

  private async isUser(userId: string): Promise<boolean> {
    if (!UUID.test(userId)) return false;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'USER' },
      select: { id: true },
    });
    return user !== null;
  }

  private where(query: SubscriptionListQuery, now: Date) {
    const parts: Prisma.Sql[] = [];
    if (query.status !== 'all') parts.push(Prisma.sql`status = ${query.status.toUpperCase()}`);
    if (query.ends === 'past') parts.push(Prisma.sql`ends_at <= ${now}::timestamptz`);
    if (query.ends === 'next7' || query.ends === 'next30') {
      const until = new Date(now.getTime() + (query.ends === 'next7' ? 7 : 30) * DAY_MS);
      parts.push(Prisma.sql`ends_at > ${now}::timestamptz AND ends_at <= ${until}::timestamptz`);
    }
    if (query.q) parts.push(Prisma.sql`creator_name ILIKE ${`%${escapeLike(query.q)}%`}`);
    return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
  }
}

function toRow(row: RawRow): SubscriptionRow {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      display_name: row.creator_name,
      avatar_url: https(row.avatar_url),
    },
    status: row.status,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
  };
}
