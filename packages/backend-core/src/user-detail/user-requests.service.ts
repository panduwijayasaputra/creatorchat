import type {
  UserRequestDetail,
  UserRequestRow,
  UserRequestSort,
  UserRequestsQuery,
  UserRequestsResponse,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { findSubscriptionBlock } from '../creator-request/subscription-block.js';
import { UUID } from './user-detail.service.js';

/** The only ORDER BY expressions that can reach the query. */
const SORT_SQL: Record<UserRequestSort, string> = { date: 'created_at', status: 'status' };
const PENDING_TEXT = 'Menunggu peninjauan';
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date);

interface RawRow {
  id: string;
  created_at: Date;
  ordinal: number;
  status: 'PENDING' | 'REJECTED';
  reviewed_at: Date | null;
  review_reason: string | null;
}

function summaryOf(row: Pick<RawRow, 'status' | 'reviewed_at' | 'review_reason'>): string {
  if (row.status === 'PENDING') return PENDING_TEXT;
  const date = row.reviewed_at ? ` ${formatDate(row.reviewed_at)}` : '';
  return `Ditolak${date}${row.review_reason ? `: ${row.review_reason}` : ''}`;
}

/** A USER's creator requests (US-018): the table, the banner data and one request. Read-only. */
export class UserRequestsService {
  private readonly clock: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  private async isUser(userId: string): Promise<boolean> {
    if (!UUID.test(userId)) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === 'USER';
  }

  async list(userId: string, query: UserRequestsQuery): Promise<UserRequestsResponse | null> {
    if (!(await this.isUser(userId))) return null;
    // The ordinal is ranked over all of the user's requests before any filter, so it never shifts.
    const base = Prisma.sql`
      SELECT a.id::text AS id, a.created_at, a.status::text AS status, a.reviewed_at, a.review_reason,
             row_number() OVER (ORDER BY a.created_at, a.id)::int AS ordinal
      FROM creator_applications a WHERE a.user_id = ${userId}::uuid AND a.status IN ('PENDING', 'REJECTED')`;
    const parts: Prisma.Sql[] = [];
    if (query.status !== 'all') parts.push(Prisma.sql`status = ${query.status.toUpperCase()}`);
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      parts.push(
        Prisma.sql`(coalesce(review_reason, '') ILIKE ${like} OR (CASE status WHEN 'PENDING' THEN ${PENDING_TEXT} ELSE 'Ditolak' END) ILIKE ${like})`,
      );
    }
    const where = parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}, created_at DESC, id`;

    const counted = await this.prisma.$queryRaw<{ total: number }[]>`
      WITH rows AS (${base}) SELECT count(*)::int AS total FROM rows ${where}`;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      WITH rows AS (${base}) SELECT * FROM rows ${where} ORDER BY ${order}
      LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`;

    const pending = await this.prisma.creatorApplication.findFirst({
      where: { userId, status: 'PENDING' },
      select: { id: true },
    });
    return {
      items: rows.map((r): UserRequestRow => ({
        id: r.id,
        created_at: r.created_at.toISOString(),
        ordinal: r.ordinal,
        status: r.status,
        summary: summaryOf(r),
      })),
      total: counted[0]?.total ?? 0,
      page: query.page,
      page_size: query.page_size as 10 | 25 | 50,
      pending: pending
        ? {
            id: pending.id,
            subscription_block: await findSubscriptionBlock(this.prisma, userId, this.clock()),
          }
        : null,
    };
  }

  /** Ownership is part of the lookup: another user's request is `null`, like an unknown id. */
  async get(userId: string, requestId: string): Promise<UserRequestDetail | null> {
    if (!UUID.test(requestId) || !(await this.isUser(userId))) return null;
    const app = await this.prisma.creatorApplication.findFirst({
      where: { id: requestId, userId, status: { in: ['PENDING', 'REJECTED'] } },
      include: {
        user: { select: { displayName: true, telegramUsername: true, telegramId: true } },
        reviewedBy: { select: { username: true } },
      },
    });
    if (!app || (app.status !== 'PENDING' && app.status !== 'REJECTED')) return null;
    const earlier = await this.prisma.creatorApplication.count({
      where: {
        userId,
        OR: [
          { createdAt: { lt: app.createdAt } },
          { createdAt: app.createdAt, id: { lte: app.id } },
        ],
      },
    });
    const request = {
      id: app.id,
      status: app.status,
      creator_name: app.creatorName,
      instagram_url: app.instagramUrl,
      creator_type: app.creatorType,
      description: app.description,
      created_at: app.createdAt.toISOString(),
      ordinal: earlier,
    };
    const applicant = {
      display_name: app.user.displayName,
      telegram_username: app.user.telegramUsername,
      telegram_id: app.user.telegramId.toString(),
    };
    if (app.status === 'PENDING') {
      return {
        request,
        applicant,
        check: { block: await findSubscriptionBlock(this.prisma, userId, this.clock()) },
        review: null,
      };
    }
    const log = await this.prisma.auditLog.findFirst({
      where: {
        action: 'creator.application.rejected',
        targetType: 'creator_application',
        targetId: app.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return {
      request,
      applicant,
      check: null,
      review: {
        reason: app.reviewReason,
        reviewed_at: app.reviewedAt?.toISOString() ?? null,
        reviewer_label: app.reviewedBy?.username ?? null,
        log_id: log?.id ?? null,
      },
    };
  }
}
