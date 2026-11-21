import { Prisma, type PrismaClient } from '@creatorchat/db';
import { attachmentsFor, type StoredAttachment } from '../media/attachments.js';
import type { MediaAccessService } from '../media/media-access.service.js';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';
import { chatAccessState, type ChatAccess } from './chat-access.js';

export const CHAT_TEXT_MAX = 2000;

export interface StoredMessage {
  id: string;
  clientMessageId: string;
  seq: number;
  sender: 'ME' | 'CREATOR';
  type: 'TEXT' | 'MEDIA';
  body: string | null;
  /** Empty for text; the photo or video of a media message (US-036). */
  attachments: StoredAttachment[];
  createdAt: Date;
}

export interface ChatHistory {
  conversation: {
    id: string;
    creator: { publicCode: string; displayName: string; avatarUrl: string | null };
    access: ChatAccess;
    /** The creator's read cursor: my messages up to it are "Dibaca" (0 = nothing read). */
    peerReadSeq: number;
  };
  /** Newest first. */
  items: StoredMessage[];
  nextBefore: number | null;
}

export type HistoryOutcome = { kind: 'ok'; history: ChatHistory } | { kind: 'not_found' };

export type SendMessageOutcome =
  | { kind: 'created' | 'replayed'; message: StoredMessage }
  | { kind: 'not_found' }
  | { kind: 'access_expired' }
  | { kind: 'creator_blocked' }
  /** The same client_message_id was already used for different text. */
  | { kind: 'conflict' }
  /** The account is no longer an ACTIVE customer (blocked or promoted since the token was issued). */
  | { kind: 'not_eligible' }
  | { kind: 'invalid' };

interface ConversationRow {
  id: string;
  creator_id: string;
  creator_blocked: boolean;
  customer_ok: boolean;
  public_code: string;
  display_name: string;
  avatar_url: string | null;
}

const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * Customer side of a private chat (US-026). Every query is scoped to the caller as the customer of
 * the conversation, so another user's id looks exactly like an unknown one. Sending locks the
 * conversation row, so concurrent sends and retries are serialised: seq is gap-free and a repeated
 * `client_message_id` returns the stored row. Access is re-checked inside the same transaction.
 */
export class ChatService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
    /** Signs the thumbnails of media messages; without it a media message has no attachment to show. */
    private readonly media: MediaAccessService | null = null,
  ) {}

  async history(
    customerId: string,
    conversationId: string,
    q: { before?: number | undefined; limit: number },
  ): Promise<HistoryOutcome> {
    const now = this.clock();
    const conv = await this.loadConversation(this.prisma, customerId, conversationId, false);
    if (!conv) return { kind: 'not_found' };
    const access = await this.accessOf(this.prisma, customerId, conv, now);
    const peer = await this.prisma.conversationRead.findFirst({
      where: { conversationId, user: { creator: { id: conv.creator_id } } },
      select: { lastReadSeq: true },
    });
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(q.before !== undefined ? { seq: { lt: q.before } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const withFiles = await attachmentsFor(
      this.prisma,
      this.media,
      customerId,
      page.filter((m) => m.type === 'MEDIA').map((m) => m.id),
      'attachment',
    );
    return {
      kind: 'ok',
      history: {
        conversation: {
          id: conv.id,
          creator: {
            publicCode: conv.public_code,
            displayName: conv.display_name,
            avatarUrl: https(conv.avatar_url),
          },
          access,
          peerReadSeq: peer?.lastReadSeq ?? 0,
        },
        items: page.map((m) => toStored(m, customerId, withFiles.get(m.id))),
        nextBefore: rows.length > q.limit && last ? last.seq : null,
      },
    };
  }

  async send(
    customerId: string,
    conversationId: string,
    input: { clientMessageId: string; body: string },
  ): Promise<SendMessageOutcome> {
    const body = input.body.trim();
    if (body.length === 0 || [...body].length > CHAT_TEXT_MAX) return { kind: 'invalid' };

    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const conv = await this.loadConversation(tx, customerId, conversationId, true);
      if (!conv) return { kind: 'not_found' } as const;

      const existing = await tx.message.findUnique({
        where: {
          conversationId_senderUserId_clientMessageId: {
            conversationId,
            senderUserId: customerId,
            clientMessageId: input.clientMessageId,
          },
        },
      });
      if (existing) {
        return existing.body === body
          ? ({ kind: 'replayed', message: toStored(existing, customerId) } as const)
          : ({ kind: 'conflict' } as const);
      }

      if (!conv.customer_ok) return { kind: 'not_eligible' } as const;
      const access = await this.accessOf(tx, customerId, conv, now);
      if (access.state === 'CREATOR_BLOCKED') return { kind: 'creator_blocked' } as const;
      if (access.state !== 'ACTIVE') return { kind: 'access_expired' } as const;

      const [counter] = await tx.$queryRaw<{ seq: number }[]>`
        UPDATE conversations SET last_message_seq = last_message_seq + 1, last_message_at = ${now}, updated_at = ${now}
        WHERE id = ${conversationId}::uuid RETURNING last_message_seq AS seq`;
      const row = await tx.message.create({
        data: {
          conversationId,
          senderUserId: customerId,
          body,
          clientMessageId: input.clientMessageId,
          seq: counter!.seq,
          createdAt: now,
        },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.MESSAGE_CREATED,
        aggregateType: 'message',
        aggregateId: row.id,
        payload: { message_id: row.id, conversation_id: conversationId, sender_id: customerId },
        dedupeKey: `message:${row.id}:created`,
      });
      return { kind: 'created', message: toStored(row, customerId) } as const;
    });
  }

  private async loadConversation(
    db: Pick<PrismaClient, '$queryRaw'>,
    customerId: string,
    conversationId: string,
    lock: boolean,
  ): Promise<ConversationRow | null> {
    const rows = await db.$queryRaw<ConversationRow[]>`
      SELECT c.id::text AS id, c.creator_id::text AS creator_id,
             (cr.status <> 'ACTIVE' OR ou.status <> 'ACTIVE') AS creator_blocked,
             (cu.status = 'ACTIVE' AND cu.role = 'USER') AS customer_ok,
             cr.public_code, ou.display_name, ou.avatar_url
      FROM conversations c
      JOIN users cu ON cu.id = c.customer_id
      JOIN creators cr ON cr.id = c.creator_id
      JOIN users ou ON ou.id = cr.user_id
      WHERE c.id = ${conversationId}::uuid AND c.customer_id = ${customerId}::uuid
      ${lock ? Prisma.sql`FOR UPDATE OF c` : Prisma.empty}`;
    return rows[0] ?? null;
  }

  private async accessOf(
    db: Pick<PrismaClient, 'subscription'>,
    customerId: string,
    conv: ConversationRow,
    now: Date,
  ): Promise<ChatAccess> {
    const subscription = await db.subscription.findUnique({
      where: { customerId_creatorId: { customerId, creatorId: conv.creator_id } },
      select: { startsAt: true, endsAt: true, revokedAt: true },
    });
    return chatAccessState({ subscription, creatorBlocked: conv.creator_blocked }, now);
  }
}

function toStored(
  m: {
    id: string;
    clientMessageId: string;
    seq: number;
    senderUserId: string;
    type: 'TEXT' | 'MEDIA';
    body: string | null;
    createdAt: Date;
  },
  customerId: string,
  attachments: StoredAttachment[] = [],
): StoredMessage {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    seq: m.seq,
    sender: m.senderUserId === customerId ? 'ME' : 'CREATOR',
    type: m.type,
    body: m.body,
    attachments,
    createdAt: m.createdAt,
  };
}
