import type { GalleryItem, MediaAsset, PrismaClient } from '@creatorchat/db';

export type GalleryRow = GalleryItem & { asset: MediaAsset };

export const encodeCursor = (seq: number): string => Buffer.from(String(seq)).toString('base64url');
export function decodeCursor(cursor: string): number | null {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  return /^[1-9]\d{0,9}$/.test(text) ? Number(text) : null;
}

type Db = Pick<PrismaClient, 'galleryItem'>;

/**
 * One page of a creator's gallery, newest first (`seq` descending), keyset-paged. Only READY assets
 * of gallery items are ever listed, whoever asks: callers decide *whether* the caller may see them.
 */
export async function pageGallery(
  db: Db,
  creatorId: string,
  query: { cursor?: string | undefined; limit: number },
): Promise<
  | { kind: 'ok'; rows: GalleryRow[]; total: number; nextCursor: string | null }
  | { kind: 'invalid_cursor' }
> {
  let before: number | null = null;
  if (query.cursor !== undefined) {
    before = decodeCursor(query.cursor);
    if (before === null) return { kind: 'invalid_cursor' };
  }
  const rows = await db.galleryItem.findMany({
    where: {
      creatorId,
      asset: { state: 'READY' },
      ...(before !== null ? { seq: { lt: before } } : {}),
    },
    orderBy: { seq: 'desc' },
    take: query.limit + 1,
    include: { asset: true },
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const total = await db.galleryItem.count({ where: { creatorId, asset: { state: 'READY' } } });
  return {
    kind: 'ok',
    rows: page,
    total,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.seq) : null,
  };
}

/** One gallery item of a creator with its place (1 = newest) and neighbours; `null` when it is not a READY gallery item of that creator. */
export async function locateGalleryItem(
  db: Db,
  creatorId: string,
  assetId: string,
): Promise<{
  row: GalleryRow;
  position: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
} | null> {
  const row = await db.galleryItem.findFirst({
    where: { creatorId, assetId, asset: { state: 'READY' } },
    include: { asset: true },
  });
  if (!row) return null;
  const ready = { creatorId, asset: { state: 'READY' as const } };
  const [newer, older, newerCount, total] = await Promise.all([
    db.galleryItem.findFirst({
      where: { ...ready, seq: { gt: row.seq } },
      orderBy: { seq: 'asc' },
      select: { assetId: true },
    }),
    db.galleryItem.findFirst({
      where: { ...ready, seq: { lt: row.seq } },
      orderBy: { seq: 'desc' },
      select: { assetId: true },
    }),
    db.galleryItem.count({ where: { ...ready, seq: { gt: row.seq } } }),
    db.galleryItem.count({ where: ready }),
  ]);
  return {
    row,
    position: newerCount + 1,
    total,
    previousId: newer?.assetId ?? null,
    nextId: older?.assetId ?? null,
  };
}
