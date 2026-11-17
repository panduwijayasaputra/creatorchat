import type {
  HistoryQuery,
  HistoryResponse,
  HistoryRow,
  HistorySort,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { AUDIT_ACTIONS, actionLabel, summaryOf } from './audit-labels.js';
import type { CreatorDetailService } from './creator-detail.service.js';

/** The only ORDER BY expressions that can reach the query. */
const SORT_SQL: Record<HistorySort, string> = {
  time: 'at',
  actor: 'lower(actor)',
  action: 'lower(label)',
  status: 'status',
};

interface RawRow {
  id: string;
  at: Date;
  actor: string;
  action: string;
  label: string;
  kind: 'account' | 'application' | 'access';
  status: 'success' | 'failed';
  changes: unknown;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/** What an audit row must target to belong to a person's History. */
export interface HistoryScope {
  userId: string;
  applicationIds: string[];
  creatorId: string | null;
  /** The user's own access requests as a customer (US-024); the creator History has none. */
  accessRequestIds?: string[];
}

/**
 * The audit rows about one person (shared by the creator and the user History): rows that target
 * the user, one of the user's applications, or the user's creator row. Labels, kind and status come
 * from the fixed action map, passed in as bound values; ORDER BY comes from a fixed map.
 */
export async function listHistory(
  prisma: PrismaClient,
  scope: HistoryScope,
  query: HistoryQuery,
): Promise<HistoryResponse> {
  const actions = Object.keys(AUDIT_ACTIONS);
  const targets: Prisma.Sql[] = [
    Prisma.sql`(a.target_type = 'user' AND a.target_id = ${scope.userId})`,
  ];
  if (scope.applicationIds.length > 0) {
    targets.push(
      Prisma.sql`(a.target_type = 'creator_application' AND a.target_id = ANY(${scope.applicationIds}::text[]))`,
    );
  }
  if (scope.accessRequestIds && scope.accessRequestIds.length > 0) {
    targets.push(
      Prisma.sql`(a.target_type = 'access_request' AND a.target_id = ANY(${scope.accessRequestIds}::text[]))`,
    );
  }
  if (scope.creatorId) {
    targets.push(Prisma.sql`(a.target_type = 'creator' AND a.target_id = ${scope.creatorId})`);
  }
  const base = Prisma.sql`
    SELECT a.id::text AS id, a.created_at AS at, a.action, a.changes,
           COALESCE(m.label, a.action) AS label,
           COALESCE(m.kind, 'account') AS kind,
           COALESCE(m.status, 'success') AS status,
           COALESCE(m.summary, '') AS summary,
           CASE a.actor_type
             WHEN 'ADMIN' THEN COALESCE((SELECT username FROM admin_accounts WHERE id = a.actor_id), 'Admin')
             WHEN 'USER' THEN COALESCE((SELECT display_name FROM users WHERE id = a.actor_id), 'User')
             ELSE 'Sistem' END AS actor
    FROM audit_logs a
    LEFT JOIN (SELECT * FROM unnest(
        ${actions}::text[], ${actions.map((a) => AUDIT_ACTIONS[a]!.label)}::text[],
        ${actions.map((a) => AUDIT_ACTIONS[a]!.kind)}::text[],
        ${actions.map((a) => (AUDIT_ACTIONS[a]!.failed ? 'failed' : 'success'))}::text[],
        ${actions.map((a) => AUDIT_ACTIONS[a]!.summary)}::text[]
      ) AS t(action, label, kind, status, summary)) m ON m.action = a.action
    WHERE ${Prisma.join(targets, ' OR ')}`;

  const parts: Prisma.Sql[] = [];
  if (query.type !== 'all') parts.push(Prisma.sql`kind = ${query.type}`);
  if (query.status !== 'all') parts.push(Prisma.sql`status = ${query.status}`);
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    parts.push(Prisma.sql`(label ILIKE ${like} OR actor ILIKE ${like} OR summary ILIKE ${like})`);
  }
  const where = parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
  const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
  const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort])} ${direction}, at DESC, id`;

  const counted = await prisma.$queryRaw<{ total: number }[]>`
    WITH rows AS (${base}) SELECT count(*)::int AS total FROM rows ${where}`;
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH rows AS (${base}) SELECT * FROM rows ${where} ORDER BY ${order}
    LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`;
  return {
    items: rows.map(toRow),
    total: counted[0]?.total ?? 0,
    page: query.page,
    page_size: query.page_size as 10 | 25 | 50,
  };
}

function toRow(row: RawRow): HistoryRow {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    action: actionLabel(row.action),
    summary: summaryOf(row.action, row.changes),
    kind: row.kind,
    status: row.status,
  };
}

export class CreatorHistoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly details: CreatorDetailService,
  ) {}

  /** `null` when the person does not resolve (same rules as the detail). */
  async list(personId: string, query: HistoryQuery): Promise<HistoryResponse | null> {
    const person = await this.details.resolve(personId);
    if (!person) return null;
    return listHistory(
      this.prisma,
      { userId: person.userId, applicationIds: person.applicationIds, creatorId: person.creatorId },
      query,
    );
  }
}
