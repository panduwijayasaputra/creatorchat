import type { PrismaClient } from '@creatorchat/db';
import { isPublicCode } from '../creator-link/public-code.js';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';
import { locateGalleryItem, pageGallery, type GalleryRow } from './gallery-queries.js';
import type { MediaAccessService } from './media-access.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a subscriber knows of an item: no state, failure or key. */
export interface PublicMediaItem {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  durationSeconds: number | null;
  thumbnailUrl: string;
}

export type CustomerGalleryListOutcome =
  | { kind: 'ok'; items: PublicMediaItem[]; total: number; nextCursor: string | null }
  | { kind: 'creator_not_found' }
  | { kind: 'not_entitled' }
  | { kind: 'invalid_cursor' };

export type CustomerGalleryItemOutcome =
  | {
      kind: 'ok';
      item: PublicMediaItem;
      original: { url: string; expiresAt: Date };
      uploadedAt: Date;
      position: number;
      total: number;
      previousId: string | null;
      nextId: string | null;
      creatorName: string;
    }
  | { kind: 'creator_not_found' }
  | { kind: 'not_entitled' }
  | { kind: 'media_not_found' };

/**
 * A customer's view of one creator's gallery (US-034), the reason the gallery exists. Every call
 * resolves the creator by public code (unknown, blocked and inactive all look the same), then checks
 * entitlement *before* touching any media, so a non-subscriber learns nothing: no count, no id.
 * Links come from `MediaAccessService`, which checks entitlement again when it signs.
 */
export class CustomerGalleryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: MediaAccessService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async gate(
    userId: string,
    publicCode: string,
  ): Promise<
    | { kind: 'ok'; creatorId: string; creatorName: string }
    | { kind: 'creator_not_found' }
    | { kind: 'not_entitled' }
  > {
    if (!isPublicCode(publicCode)) return { kind: 'creator_not_found' };
    const creator = await this.prisma.creator.findFirst({
      where: { publicCode, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      select: { id: true, user: { select: { displayName: true } } },
    });
    if (!creator) return { kind: 'creator_not_found' };
    const [entitled] = await this.prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM ${ENTITLED_FROM}
      WHERE s.customer_id = ${userId}::uuid AND s.creator_id = ${creator.id}::uuid
        AND ${entitledSubscriptionSql(this.clock())}
      LIMIT 1`;
    if (!entitled) return { kind: 'not_entitled' };
    return { kind: 'ok', creatorId: creator.id, creatorName: creator.user.displayName };
  }

  async list(
    userId: string,
    publicCode: string,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<CustomerGalleryListOutcome> {
    const gate = await this.gate(userId, publicCode);
    if (gate.kind !== 'ok') return gate;
    const page = await pageGallery(this.prisma, gate.creatorId, query);
    if (page.kind === 'invalid_cursor') return page;
    const items = await this.publicItems(
      userId,
      page.rows.map((r) => r.asset),
    );
    return { kind: 'ok', items, total: page.total, nextCursor: page.nextCursor };
  }

  async item(
    userId: string,
    publicCode: string,
    assetId: string,
  ): Promise<CustomerGalleryItemOutcome> {
    const gate = await this.gate(userId, publicCode);
    if (gate.kind !== 'ok') return gate;
    // After the gate, so a non-subscriber cannot tell a malformed id from a missing one.
    if (!UUID.test(assetId)) return { kind: 'media_not_found' };
    const found = await locateGalleryItem(this.prisma, gate.creatorId, assetId);
    if (!found) return { kind: 'media_not_found' };
    const original = await this.access.originalUrlForSubscriber(
      userId,
      found.row.asset,
      this.clock(),
    );
    const [item] = await this.publicItems(userId, [found.row.asset]);
    // Access can end between the gate and signing: the signer's own check then answers null.
    if (!original || !item) return { kind: 'not_entitled' };
    return {
      kind: 'ok',
      item,
      original,
      uploadedAt: found.row.addedAt,
      position: found.position,
      total: found.total,
      previousId: found.previousId,
      nextId: found.nextId,
      creatorName: gate.creatorName,
    };
  }

  /** Items that have no signed thumbnail (access just ended) are dropped rather than shown bare. */
  private async publicItems(
    userId: string,
    assets: GalleryRow['asset'][],
  ): Promise<PublicMediaItem[]> {
    const urls = await this.access.thumbnailUrlsForSubscriber(userId, assets, this.clock());
    return assets.flatMap((a) => {
      const thumbnailUrl = urls.get(a.id);
      return thumbnailUrl
        ? [
            {
              id: a.id,
              kind: a.kind,
              durationSeconds: a.durationMs === null ? null : Math.round(a.durationMs / 1000),
              thumbnailUrl,
            },
          ]
        : [];
    });
  }
}
