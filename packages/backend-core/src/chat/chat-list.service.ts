import { CHAT_PREVIEW_MAX } from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import { chatAccessState, type ChatAccess } from './chat-access.js';
import { decodeChatCursor, encodeChatCursor } from './chat-cursor.js';

export interface ChatListRow {
  conversationId: string;
  publicCode: string;
  displayName: string;
  avatarUrl: string | null;
  lastMessage: { preview: string; at: Date; mediaKind: 'PHOTO' | 'VIDEO' | null } | null;
  unreadCount: number;
  access: ChatAccess['state'];
}

export type ChatListOutcome =
  { kind: 'ok'; items: ChatListRow[]; nextCursor: string | null } | { kind: 'bad_cursor' };

interface PageRow {
  id: string;
  creator_id: string;
  public_code: string;
  display_name: string;
  avatar_url: string | null;
  creator_blocked: boolean;
  preview: string | null;
  media_kind: 'PHOTO' | 'VIDEO' | null;
  last_at: Date | null;
  activity: Date;
}

const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * The customer's chat list and unread total (US-027). Read-only. Every statement carries
 * `customer_id = me`, so another customer's conversation can never appear; the cursor is only a
 * comparison boundary inside that filter. One page query, one grouped unread count and one
 * subscription lookup per page (no per-row queries). Access uses the chat screen's own rule, so the
 * list and the conversation cannot disagree.
 */
export class ChatListService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(userId: string, query: { cursor?: string; limit: number }): Promise<ChatListOutcome> {
    const cursor = query.cursor === undefined ? null : decodeChatCursor(query.cursor);
    if (query.cursor !== undefined && !cursor) return { kind: 'bad_cursor' };
    const now = this.clock();

    const after = cursor
      ? Prisma.sql`AND (coalesce(lm.created_at, c.created_at), c.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<PageRow[]>`
      SELECT c.id::text AS id, c.creator_id::text AS creator_id, cr.public_code,
             ou.display_name, ou.avatar_url,
             (cr.status <> 'ACTIVE' OR ou.status <> 'ACTIVE') AS creator_blocked,
             lm.preview, lm.media_kind, lm.created_at AS last_at,
             coalesce(lm.created_at, c.created_at) AS activity
      FROM conversations c
      JOIN creators cr ON cr.id = c.creator_id
      JOIN users ou ON ou.id = cr.user_id
      LEFT JOIN LATERAL (
        SELECT left(btrim(regexp_replace(coalesce(m.body, ''), '[[:space:]]+', ' ', 'g')), ${CHAT_PREVIEW_MAX}) AS preview,
               (SELECT a.kind::text FROM message_attachments ma JOIN media_assets a ON a.id = ma.asset_id
                 WHERE ma.message_id = m.id ORDER BY ma.position LIMIT 1) AS media_kind,
               m.created_at
        FROM messages m WHERE m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1
      ) lm ON true
      WHERE c.customer_id = ${userId}::uuid ${after}
      ORDER BY activity DESC, c.id DESC
      LIMIT ${query.limit + 1}`;

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last
        ? encodeChatCursor({ at: last.activity, id: last.id })
        : null;
    if (page.length === 0) return { kind: 'ok', items: [], nextCursor: null };

    const ids = page.map((r) => r.id);
    const [unread, subscriptions] = await Promise.all([
      this.prisma.$queryRaw<{ conversation_id: string; n: number }[]>`
        SELECT m.conversation_id::text AS conversation_id, count(*)::int AS n
        FROM messages m
        LEFT JOIN conversation_reads r
          ON r.conversation_id = m.conversation_id AND r.user_id = ${userId}::uuid
        WHERE m.conversation_id = ANY(${ids}::uuid[])
          AND m.sender_user_id <> ${userId}::uuid
          AND m.seq > coalesce(r.last_read_seq, 0)
        GROUP BY m.conversation_id`,
      this.prisma.subscription.findMany({
        where: { customerId: userId, creatorId: { in: page.map((r) => r.creator_id) } },
        select: { creatorId: true, startsAt: true, endsAt: true, revokedAt: true },
      }),
    ]);
    const unreadOf = new Map(unread.map((u) => [u.conversation_id, u.n]));
    const subOf = new Map(subscriptions.map((s) => [s.creatorId, s]));

    return {
      kind: 'ok',
      nextCursor,
      items: page.map((r) => ({
        conversationId: r.id,
        publicCode: r.public_code,
        displayName: r.display_name,
        avatarUrl: https(r.avatar_url),
        lastMessage:
          r.preview !== null && r.last_at
            ? { preview: r.preview, at: r.last_at, mediaKind: r.media_kind }
            : null,
        unreadCount: unreadOf.get(r.id) ?? 0,
        access: chatAccessState(
          { subscription: subOf.get(r.creator_id) ?? null, creatorBlocked: r.creator_blocked },
          now,
        ).state,
      })),
    };
  }

  /** Unread across all of the customer's conversations, expired and blocked-creator ones included. */
  async unreadTotal(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id AND c.customer_id = ${userId}::uuid
      LEFT JOIN conversation_reads r
        ON r.conversation_id = m.conversation_id AND r.user_id = ${userId}::uuid
      WHERE m.sender_user_id <> ${userId}::uuid AND m.seq > coalesce(r.last_read_seq, 0)`;
    return rows[0]?.n ?? 0;
  }
}
