import type { ChatMediaDetail, ChatMediaItem } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import type { MediaAccessService } from './media-access.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** shortcut: the list is capped at 500 files; page it if a conversation ever holds more. */
const LIST_MAX = 500;

export type ChatMediaListOutcome = { kind: 'ok'; items: ChatMediaItem[] } | { kind: 'not_found' };
export type ChatMediaDetailOutcome =
  { kind: 'ok'; detail: ChatMediaDetail } | { kind: 'not_found' };

interface ListRow {
  id: string;
  asset_id: string;
  kind: 'PHOTO' | 'VIDEO';
  duration_ms: number | null;
  thumb_key: string | null;
}

interface DetailRow extends ListRow {
  object_key: string;
  mime: string | null;
  body: string | null;
  created_at: Date;
  creator_name: string;
  pos: number;
  total: number;
  prev_id: string | null;
  next_id: string | null;
}

/**
 * The customer's view of the files in their own conversation (US-037). Everything is scoped by
 * `conversations.customer_id = me` and the conversation id, so another customer's conversation, an
 * attachment of another conversation and an asset id passed as an attachment id all look unknown.
 * There is deliberately no subscription check: a received file stays readable after expiry or when
 * the creator is blocked (brief §6, §8E); a blocked customer is stopped by the session guard.
 */
export class ChatMediaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: MediaAccessService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(customerId: string, conversationId: string): Promise<ChatMediaListOutcome> {
    if (!UUID.test(conversationId)) return { kind: 'not_found' };
    const [mine] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM conversations
      WHERE id = ${conversationId}::uuid AND customer_id = ${customerId}::uuid`;
    if (!mine) return { kind: 'not_found' };
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT ma.id::text AS id, a.id::text AS asset_id, a.kind::text AS kind, a.duration_ms, a.thumb_key
      FROM message_attachments ma
      JOIN messages m ON m.id = ma.message_id
      JOIN media_assets a ON a.id = ma.asset_id
      WHERE m.conversation_id = ${conversationId}::uuid AND a.state = 'READY'
      ORDER BY m.seq, ma.position
      LIMIT ${LIST_MAX}`;
    const urls = await this.access.thumbnailUrlsForParticipant(
      customerId,
      rows.map((r) => ({ id: r.asset_id, thumbKey: r.thumb_key })),
    );
    return {
      kind: 'ok',
      items: rows.flatMap((r) => {
        const thumbnail_url = urls.get(r.asset_id);
        return thumbnail_url ? [toItem(r, thumbnail_url)] : [];
      }),
    };
  }

  async detail(
    customerId: string,
    conversationId: string,
    attachmentId: string,
  ): Promise<ChatMediaDetailOutcome> {
    if (!UUID.test(conversationId) || !UUID.test(attachmentId)) return { kind: 'not_found' };
    const [row] = await this.prisma.$queryRaw<DetailRow[]>`
      WITH ordered AS (
        SELECT ma.id::text AS id, a.id::text AS asset_id, a.kind::text AS kind, a.duration_ms,
               a.thumb_key, a.object_key, a.mime, m.body, m.created_at, ou.display_name AS creator_name,
               row_number() OVER (ORDER BY m.seq, ma.position)::int AS pos,
               count(*) OVER ()::int AS total,
               lag(ma.id::text) OVER (ORDER BY m.seq, ma.position) AS prev_id,
               lead(ma.id::text) OVER (ORDER BY m.seq, ma.position) AS next_id
        FROM message_attachments ma
        JOIN messages m ON m.id = ma.message_id
        JOIN media_assets a ON a.id = ma.asset_id
        JOIN conversations c ON c.id = m.conversation_id
        JOIN creators cr ON cr.id = c.creator_id
        JOIN users ou ON ou.id = cr.user_id
        WHERE c.id = ${conversationId}::uuid AND c.customer_id = ${customerId}::uuid
          AND a.state = 'READY')
      SELECT * FROM ordered WHERE id = ${attachmentId}`;
    if (!row) return { kind: 'not_found' };
    const original = await this.access.originalUrlForParticipant(
      customerId,
      { id: row.asset_id, objectKey: row.object_key, mime: row.mime },
      this.clock(),
    );
    const thumbs = await this.access.thumbnailUrlsForParticipant(customerId, [
      { id: row.asset_id, thumbKey: row.thumb_key },
    ]);
    const thumbnail = thumbs.get(row.asset_id);
    if (!original || !thumbnail) return { kind: 'not_found' };
    return {
      kind: 'ok',
      detail: {
        item: toItem(row, thumbnail),
        original: { url: original.url, expires_at: original.expiresAt.toISOString() },
        message: { body: row.body, created_at: row.created_at.toISOString() },
        creator: { display_name: row.creator_name },
        position: row.pos,
        total: row.total,
        previous_id: row.prev_id,
        next_id: row.next_id,
      },
    };
  }
}

const toItem = (r: ListRow, thumbnail_url: string): ChatMediaItem => ({
  id: r.id,
  kind: r.kind,
  duration_seconds: r.duration_ms === null ? null : Math.round(r.duration_ms / 1000),
  thumbnail_url,
});
