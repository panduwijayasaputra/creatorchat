import type {
  AdminGalleryQuery,
  AdminGalleryResponse,
  AdminGallerySort,
  AdminMediaDetail,
} from '@creatorchat/contracts';
import { Prisma, type PrismaClient } from '@creatorchat/db';
import type { MediaAccessService } from './media-access.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/** The only ORDER BY expressions that can reach the query; the request picks a key, never text. */
const SORT_SQL: Record<AdminGallerySort, string> = {
  number: 'g.seq',
  kind: 'a.kind',
  duration: 'a.duration_ms',
  size: 'a.size_bytes',
  uploaded: 'g.added_at',
};

interface RawRow {
  asset_id: string;
  number: number;
  kind: 'PHOTO' | 'VIDEO';
  duration_ms: number | null;
  size_bytes: bigint;
  uploaded_at: Date;
  thumb_key: string | null;
}

export type AdminGalleryOutcome =
  { kind: 'ok'; page: AdminGalleryResponse } | { kind: 'creator_not_found' };

export type AdminMediaOutcome =
  | { kind: 'ok'; detail: AdminMediaDetail }
  | { kind: 'creator_not_found' }
  | { kind: 'media_not_found' };

/**
 * The admin's read-only view of one creator's gallery (US-035). Rows come only from the creator's
 * gallery items with READY assets; chat-only and broadcast-only assets have no gallery item, so they
 * can never appear, and no message, attachment or conversation table is joined. Signed links are
 * issued by `MediaAccessService` for exactly that creator's gallery items.
 */
export class AdminCreatorGalleryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: MediaAccessService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async creator(id: string) {
    if (!UUID.test(id)) return null;
    return this.prisma.creator.findUnique({
      where: { id },
      select: { id: true, user: { select: { displayName: true } } },
    });
  }

  async list(creatorId: string, query: AdminGalleryQuery): Promise<AdminGalleryOutcome> {
    const creator = await this.creator(creatorId);
    if (!creator) return { kind: 'creator_not_found' };

    const parts: Prisma.Sql[] = [
      Prisma.sql`g.creator_id = ${creator.id}::uuid`,
      Prisma.sql`a.state = 'READY'`,
    ];
    if (query.kind !== 'all') parts.push(Prisma.sql`a.kind = ${query.kind}::"MediaKind"`);
    if (query.uploaded !== 'all') {
      const since = new Date(this.clock().getTime() - Number(query.uploaded) * DAY_MS);
      parts.push(Prisma.sql`g.added_at >= ${since}::timestamptz`);
    }
    if (query.q) {
      // Media has no title: the only searchable thing is its number ("12" or "#12").
      const m = /^#?(\d{1,9})$/.exec(query.q);
      parts.push(m ? Prisma.sql`g.seq = ${Number(m[1])}` : Prisma.sql`FALSE`);
    }
    const where = Prisma.join(parts, ' AND ');
    const direction = Prisma.raw(query.dir === 'asc' ? 'ASC' : 'DESC');
    const order = Prisma.sql`${Prisma.raw(SORT_SQL[query.sort] ?? 'g.added_at')} ${direction} NULLS LAST, g.seq DESC`;

    const [counted] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM gallery_items g
      JOIN media_assets a ON a.id = g.asset_id WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT a.id::text AS asset_id, g.seq AS number, a.kind::text AS kind, a.duration_ms,
             a.size_bytes, g.added_at AS uploaded_at, a.thumb_key
      FROM gallery_items g JOIN media_assets a ON a.id = g.asset_id
      WHERE ${where} ORDER BY ${order}
      LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`;

    const urls = await this.access.thumbnailUrlsForAdmin(
      creator.id,
      rows.map((r) => ({ id: r.asset_id, thumbKey: r.thumb_key })),
    );
    return {
      kind: 'ok',
      page: {
        items: rows.flatMap((r) => {
          const thumbnail = urls.get(r.asset_id);
          return thumbnail
            ? [
                {
                  asset_id: r.asset_id,
                  number: r.number,
                  kind: r.kind,
                  duration_seconds:
                    r.duration_ms === null ? null : Math.round(r.duration_ms / 1000),
                  size_bytes: Number(r.size_bytes),
                  uploaded_at: r.uploaded_at.toISOString(),
                  thumbnail_url: thumbnail,
                },
              ]
            : [];
        }),
        total: counted?.total ?? 0,
        page: query.page,
        page_size: query.page_size as 10 | 25 | 50,
      },
    };
  }

  async detail(creatorId: string, assetId: string): Promise<AdminMediaOutcome> {
    const creator = await this.creator(creatorId);
    if (!creator) return { kind: 'creator_not_found' };
    if (!UUID.test(assetId)) return { kind: 'media_not_found' };
    const item = await this.prisma.galleryItem.findFirst({
      where: { creatorId: creator.id, assetId, asset: { state: 'READY' } },
      include: { asset: true },
    });
    if (!item) return { kind: 'media_not_found' };
    const original = await this.access.originalUrlForAdmin(creator.id, item.asset, this.clock());
    if (!original) return { kind: 'media_not_found' };
    const poster =
      item.asset.kind === 'VIDEO'
        ? ((await this.access.thumbnailUrlsForAdmin(creator.id, [item.asset])).get(item.asset.id) ??
          null)
        : null;
    return {
      kind: 'ok',
      detail: {
        asset_id: item.asset.id,
        short_id: `med_${item.asset.id.replace(/-/g, '').slice(0, 7)}`,
        number: item.seq,
        kind: item.asset.kind,
        duration_seconds:
          item.asset.durationMs === null ? null : Math.round(item.asset.durationMs / 1000),
        size_bytes: Number(item.asset.sizeBytes ?? 0n),
        uploaded_at: item.addedAt.toISOString(),
        creator: { id: creator.id, display_name: creator.user.displayName },
        shown_in: 'GALLERY',
        preview: { url: original.url, expires_at: original.expiresAt.toISOString() },
        poster_url: poster,
      },
    };
  }
}
