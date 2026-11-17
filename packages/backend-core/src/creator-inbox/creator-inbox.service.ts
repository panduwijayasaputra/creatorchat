import { decodeInboxCursor, encodeInboxCursor } from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';

export interface InboxRow {
  conversationId: string;
  customerName: string;
  customerAvatarUrl: string | null;
  preview: string;
  /** What the last message carries, so the row can say "Foto" / "Video" (US-036). */
  previewMediaKind: 'PHOTO' | 'VIDEO' | null;
  lastMessageAt: Date;
  unreadCount: number;
  accessActive: boolean;
}

export type InboxOutcome =
  | { kind: 'ok'; items: InboxRow[]; nextCursor: string | null; unreadConversations: number }
  | { kind: 'bad_cursor' };

interface DbRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  preview: string | null;
  preview_media_kind: 'PHOTO' | 'VIDEO' | null;
  last_message_at: Date;
  unread_count: number;
  access_active: boolean;
}

const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * The creator's inbox (US-028): their own non-empty conversations, newest activity first, with
 * unread counts (customer messages above the creator's read cursor) and whether the customer's
 * access is still active. The creator is found from the session's user id, never from the request,
 * so no other creator's conversation can match. Read-only.
 *
 * Outer aliases avoid `s`, `cu`, `sc` and `ou`, which the entitlement predicate uses.
 */
export class CreatorInboxService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(
    creatorUserId: string,
    q: { filter: 'all' | 'unread'; cursor?: string | undefined; limit: number },
  ): Promise<InboxOutcome> {
    const cursor = q.cursor === undefined ? null : decodeInboxCursor(q.cursor);
    if (q.cursor !== undefined && !cursor) return { kind: 'bad_cursor' };

    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorUserId },
      select: { id: true },
    });
    if (!creator) return { kind: 'ok', items: [], nextCursor: null, unreadConversations: 0 };

    const now = this.clock();
    const keyset = cursor
      ? Prisma.sql`AND (last_message_at, id) < (${cursor.at}::timestamptz, ${cursor.id}::text)`
      : Prisma.empty;
    const unreadOnly = q.filter === 'unread' ? Prisma.sql`AND unread_count > 0` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<DbRow[]>`
      WITH inbox AS (
        SELECT cv.id::text AS id, cx.display_name, cx.avatar_url,
               btrim(left(regexp_replace(coalesce(lm.body, ''), '\\s+', ' ', 'g'), 120)) AS preview,
               (SELECT a.kind::text FROM message_attachments ma JOIN media_assets a ON a.id = ma.asset_id
                 WHERE ma.message_id = lm.id ORDER BY ma.position LIMIT 1) AS preview_media_kind,
               cv.last_message_at,
               (SELECT count(*)::int FROM messages um
                 WHERE um.conversation_id = cv.id
                   AND um.sender_user_id <> ${creatorUserId}::uuid
                   AND um.seq > coalesce(rd.last_read_seq, 0)) AS unread_count,
               EXISTS (SELECT 1 FROM ${ENTITLED_FROM}
                        WHERE s.customer_id = cv.customer_id AND s.creator_id = cv.creator_id
                          AND ${entitledSubscriptionSql(now)}) AS access_active
        FROM conversations cv
        JOIN users cx ON cx.id = cv.customer_id
        LEFT JOIN messages lm ON lm.conversation_id = cv.id AND lm.seq = cv.last_message_seq
        LEFT JOIN conversation_reads rd
               ON rd.conversation_id = cv.id AND rd.user_id = ${creatorUserId}::uuid
        WHERE cv.creator_id = ${creator.id}::uuid AND cv.last_message_at IS NOT NULL
      )
      SELECT * FROM inbox
      WHERE true ${unreadOnly} ${keyset}
      ORDER BY last_message_at DESC, id DESC
      LIMIT ${q.limit + 1}`;

    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const unreadConversations = await this.countUnread(creator.id, creatorUserId);

    return {
      kind: 'ok',
      items: page.map((r) => ({
        conversationId: r.id,
        customerName: r.display_name,
        customerAvatarUrl: https(r.avatar_url),
        preview: r.preview ?? '',
        previewMediaKind: r.preview_media_kind,
        lastMessageAt: r.last_message_at,
        unreadCount: r.unread_count,
        accessActive: r.access_active,
      })),
      nextCursor:
        rows.length > q.limit && last ? encodeInboxCursor(last.last_message_at, last.id) : null,
      unreadConversations,
    };
  }

  /** The creator's bottom-nav badge: how many conversations have unread customer messages. */
  async unreadConversations(creatorUserId: string): Promise<number> {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorUserId },
      select: { id: true },
    });
    return creator ? this.countUnread(creator.id, creatorUserId) : 0;
  }

  private async countUnread(creatorId: string, creatorUserId: string): Promise<number> {
    const counted = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM conversations cv
      LEFT JOIN conversation_reads rd
             ON rd.conversation_id = cv.id AND rd.user_id = ${creatorUserId}::uuid
      WHERE cv.creator_id = ${creatorId}::uuid AND cv.last_message_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM messages um
                     WHERE um.conversation_id = cv.id
                       AND um.sender_user_id <> ${creatorUserId}::uuid
                       AND um.seq > coalesce(rd.last_read_seq, 0))`;
    return counted[0]?.n ?? 0;
  }
}
