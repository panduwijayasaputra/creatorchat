import type { PrismaClient } from '@creatorchat/db';
import type { MediaAccessService } from './media-access.service.js';

/** What a chat client may know of a message's file: an id, the kind and a short-lived thumbnail. */
export interface StoredAttachment {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  durationSeconds: number | null;
  thumbnailUrl: string;
}

interface Row {
  message_id: string;
  id: string;
  attachment_id: string;
  kind: 'PHOTO' | 'VIDEO';
  duration_ms: number | null;
  thumb_key: string | null;
}

/**
 * The attachments of some messages (one query), READY files only, with signed thumbnails. Callers
 * pass messages they already loaded through a query scoped to their own conversation; the signer
 * checks once more that the caller takes part in the conversation the file was sent in.
 *
 * `idOf` says which id the client gets as `attachment.id`: the creator sees the asset id (it names
 * gallery files in the picker), a customer sees the id of the attachment row, which is what the
 * viewer endpoint takes (US-037) and never reveals which asset sits behind it.
 */
export async function attachmentsFor(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  access: MediaAccessService | null,
  userId: string,
  messageIds: string[],
  idOf: 'asset' | 'attachment' = 'asset',
): Promise<Map<string, StoredAttachment[]>> {
  const result = new Map<string, StoredAttachment[]>();
  if (messageIds.length === 0 || !access) return result;
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT ma.message_id::text AS message_id, a.id::text AS id, ma.id::text AS attachment_id,
           a.kind::text AS kind,
           a.duration_ms, a.thumb_key
    FROM message_attachments ma JOIN media_assets a ON a.id = ma.asset_id
    WHERE ma.message_id = ANY(${messageIds}::uuid[]) AND a.state = 'READY'
    ORDER BY ma.message_id, ma.position`;
  const urls = await access.thumbnailUrlsForParticipant(
    userId,
    rows.map((r) => ({ id: r.id, thumbKey: r.thumb_key })),
  );
  for (const r of rows) {
    const thumbnailUrl = urls.get(r.id);
    if (!thumbnailUrl) continue;
    const list = result.get(r.message_id) ?? [];
    list.push({
      id: idOf === 'attachment' ? r.attachment_id : r.id,
      kind: r.kind,
      durationSeconds: r.duration_ms === null ? null : Math.round(r.duration_ms / 1000),
      thumbnailUrl,
    });
    result.set(r.message_id, list);
  }
  return result;
}
