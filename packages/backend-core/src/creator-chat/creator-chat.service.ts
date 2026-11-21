import { Prisma, type PrismaClient } from '@creatorchat/db';
import { CHAT_TEXT_MAX } from '../chat/chat.service.js';
import { writeCreatorMessage } from '../chat/message-writer.js';
import { attachmentsFor, type StoredAttachment } from '../media/attachments.js';
import type { MediaAccessService } from '../media/media-access.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import { isEntitled } from '../subscription-access/entitlement.js';

export interface CreatorChatMessage {
  id: string;
  clientMessageId: string;
  seq: number;
  sender: 'ME' | 'CUSTOMER';
  type: 'TEXT' | 'MEDIA';
  body: string | null;
  /** Empty for text; the photo or video of a media message (US-036). */
  attachments: StoredAttachment[];
  origin: 'MANUAL' | 'AI';
  createdAt: Date;
}

/** The creator sees two states; a blocked, promoted or unsubscribed customer all count as EXPIRED. */
export type CreatorChatAccess =
  { state: 'ACTIVE'; endsAt: Date } | { state: 'EXPIRED'; endedAt: Date | null };

export interface CreatorChatHistory {
  conversation: {
    id: string;
    customer: { displayName: string; avatarUrl: string | null };
    access: CreatorChatAccess;
  };
  /** Newest first. */
  items: CreatorChatMessage[];
  nextBefore: number | null;
}

export type CreatorHistoryOutcome =
  { kind: 'ok'; history: CreatorChatHistory } | { kind: 'not_found' };

export type CreatorSendOutcome =
  | { kind: 'created' | 'replayed'; message: CreatorChatMessage }
  | { kind: 'not_found' | 'access_expired' | 'conflict' | 'invalid' }
  /** The attachment is not one this creator may send here (unknown, someone else's, used already). */
  | { kind: 'media_not_found' }
  /** The attachment exists but is still being processed. */
  | { kind: 'media_not_ready' };

export type CustomerDetailOutcome =
  | {
      kind: 'ok';
      customer: { displayName: string; avatarUrl: string | null; username: string | null };
      access: CreatorChatAccess;
    }
  | { kind: 'not_found' };

interface ConversationRow {
  id: string;
  customer_id: string;
  creator_id: string;
  customer_ok: boolean;
  display_name: string;
  avatar_url: string | null;
  telegram_username: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const https = (url: string | null) => (url?.startsWith('https://') ? url : null);

/**
 * Creator side of a private chat (US-029). Every query is scoped to the caller as the creator of the
 * conversation (`creators.user_id = me`), so another creator's id looks exactly like an unknown one.
 * Sending locks the conversation row like the customer send, so retries and concurrent sends are
 * serialised and a repeated `client_message_id` returns the stored row.
 */
export class CreatorChatService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
    /** Signs the thumbnails of media messages (US-036). */
    private readonly media: MediaAccessService | null = null,
  ) {}

  async history(
    creatorUserId: string,
    conversationId: string,
    q: { before?: number | undefined; limit: number },
  ): Promise<CreatorHistoryOutcome> {
    const conv = await this.load(this.prisma, creatorUserId, conversationId, false);
    if (!conv) return { kind: 'not_found' };
    const access = await this.accessOf(this.prisma, conv, this.clock());
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
      creatorUserId,
      page.filter((m) => m.type === 'MEDIA').map((m) => m.id),
    );
    return {
      kind: 'ok',
      history: {
        conversation: {
          id: conv.id,
          customer: { displayName: conv.display_name, avatarUrl: https(conv.avatar_url) },
          access,
        },
        items: page.map((m) => toStored(m, creatorUserId, withFiles.get(m.id))),
        nextBefore: rows.length > q.limit && last ? last.seq : null,
      },
    };
  }

  async customerDetail(
    creatorUserId: string,
    conversationId: string,
  ): Promise<CustomerDetailOutcome> {
    const conv = await this.load(this.prisma, creatorUserId, conversationId, false);
    if (!conv) return { kind: 'not_found' };
    return {
      kind: 'ok',
      customer: {
        displayName: conv.display_name,
        avatarUrl: https(conv.avatar_url),
        username: conv.telegram_username,
      },
      access: await this.accessOf(this.prisma, conv, this.clock()),
    };
  }

  /**
   * Sends text, one photo or video, or both. Under the conversation lock: a repeated
   * `client_message_id` returns the stored message (same text and file) or conflicts, access is
   * re-checked, and the file is validated (the creator's own gallery asset, or a chat upload made for
   * this conversation and not sent yet). A gallery pick attaches the same asset: no copy is made.
   */
  async send(
    creatorUserId: string,
    conversationId: string,
    input: {
      clientMessageId: string;
      body?: string | undefined;
      attachmentAssetId?: string | undefined;
    },
  ): Promise<CreatorSendOutcome> {
    const body = input.body === undefined ? null : input.body.trim();
    if (body !== null && (body.length === 0 || [...body].length > CHAT_TEXT_MAX)) {
      return { kind: 'invalid' };
    }
    const assetId = input.attachmentAssetId ?? null;
    if (body === null && assetId === null) return { kind: 'invalid' };
    if (assetId !== null && !UUID.test(assetId)) return { kind: 'media_not_found' };

    const outcome = await this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const conv = await this.load(tx, creatorUserId, conversationId, true);
      if (!conv) return { kind: 'not_found' } as const;

      const existing = await tx.message.findUnique({
        where: {
          conversationId_senderUserId_clientMessageId: {
            conversationId,
            senderUserId: creatorUserId,
            clientMessageId: input.clientMessageId,
          },
        },
        include: { attachments: { select: { assetId: true }, orderBy: { position: 'asc' } } },
      });
      if (existing) {
        const sameFile = (existing.attachments[0]?.assetId ?? null) === assetId;
        return existing.body === body && sameFile
          ? ({ kind: 'replayed', row: existing } as const)
          : ({ kind: 'conflict' } as const);
      }

      const access = await this.accessOf(tx, conv, now);
      if (access.state !== 'ACTIVE') return { kind: 'access_expired' } as const;

      if (assetId !== null) {
        // Locking the asset row serialises a send with the cleanup of unsent chat uploads.
        const [asset] = await tx.$queryRaw<
          {
            state: string;
            purpose: string;
            conversation_id: string | null;
            in_gallery: boolean;
            attached: boolean;
          }[]
        >`
          SELECT a.state::text AS state, a.purpose::text AS purpose,
                 a.conversation_id::text AS conversation_id,
                 EXISTS (SELECT 1 FROM gallery_items g WHERE g.asset_id = a.id) AS in_gallery,
                 EXISTS (SELECT 1 FROM message_attachments x WHERE x.asset_id = a.id) AS attached
          FROM media_assets a
          WHERE a.id = ${assetId}::uuid AND a.creator_id = ${conv.creator_id}::uuid
          FOR UPDATE OF a`;
        if (!asset) return { kind: 'media_not_found' } as const;
        if (asset.purpose === 'CHAT') {
          if (asset.conversation_id !== conversationId || asset.attached) {
            return { kind: 'media_not_found' } as const;
          }
          if (asset.state === 'PENDING' || asset.state === 'PROCESSING') {
            return { kind: 'media_not_ready' } as const;
          }
          if (asset.state !== 'READY') return { kind: 'media_not_found' } as const;
        } else if (asset.state !== 'READY' || !asset.in_gallery) {
          return { kind: 'media_not_found' } as const;
        }
      }

      const row = await writeCreatorMessage(tx, this.outbox, {
        conversationId,
        creatorUserId,
        clientMessageId: input.clientMessageId,
        body,
        assetId,
        now,
      });
      return { kind: 'created', row } as const;
    });

    if (outcome.kind !== 'created' && outcome.kind !== 'replayed') return outcome;
    const files = await attachmentsFor(
      this.prisma,
      this.media,
      creatorUserId,
      outcome.row.type === 'MEDIA' ? [outcome.row.id] : [],
    );
    return {
      kind: outcome.kind,
      message: toStored(outcome.row, creatorUserId, files.get(outcome.row.id)),
    };
  }

  /** Only an ACTIVE creator account that owns the conversation; anything else is "not found". */
  private async load(
    db: Pick<PrismaClient, '$queryRaw'>,
    creatorUserId: string,
    conversationId: string,
    lock: boolean,
  ): Promise<ConversationRow | null> {
    const rows = await db.$queryRaw<ConversationRow[]>`
      SELECT c.id::text AS id, c.customer_id::text AS customer_id, c.creator_id::text AS creator_id,
             (cu.status = 'ACTIVE' AND cu.role = 'USER') AS customer_ok,
             cu.display_name, cu.avatar_url, cu.telegram_username
      FROM conversations c
      JOIN creators cr ON cr.id = c.creator_id AND cr.user_id = ${creatorUserId}::uuid
      JOIN users ou ON ou.id = cr.user_id
      JOIN users cu ON cu.id = c.customer_id
      WHERE c.id = ${conversationId}::uuid AND cr.status = 'ACTIVE' AND ou.status = 'ACTIVE'
      ${lock ? Prisma.sql`FOR UPDATE OF c` : Prisma.empty}`;
    return rows[0] ?? null;
  }

  private async accessOf(
    db: Pick<PrismaClient, 'subscription'>,
    conv: ConversationRow,
    now: Date,
  ): Promise<CreatorChatAccess> {
    const sub = await db.subscription.findUnique({
      where: { customerId_creatorId: { customerId: conv.customer_id, creatorId: conv.creator_id } },
      select: { startsAt: true, endsAt: true, revokedAt: true },
    });
    if (sub && conv.customer_ok && isEntitled(sub, now)) {
      return { state: 'ACTIVE', endsAt: sub.endsAt };
    }
    if (!sub) return { state: 'EXPIRED', endedAt: null };
    const ended = sub.revokedAt && sub.revokedAt < sub.endsAt ? sub.revokedAt : sub.endsAt;
    return { state: 'EXPIRED', endedAt: ended };
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
    origin: 'MANUAL' | 'AI';
    createdAt: Date;
  },
  creatorUserId: string,
  attachments: StoredAttachment[] = [],
): CreatorChatMessage {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    seq: m.seq,
    sender: m.senderUserId === creatorUserId ? 'ME' : 'CUSTOMER',
    type: m.type,
    body: m.body,
    attachments,
    origin: m.origin,
    createdAt: m.createdAt,
  };
}
