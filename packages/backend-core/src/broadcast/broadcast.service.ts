import type { PrismaClient } from '@creatorchat/db';
import { addToGallery } from '../media/gallery-membership.js';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';
import type { FixedWindowLimiter } from '../user-auth/rate-limiter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Same limit as a chat message. */
const BODY_MAX = 2000;

/** Sends per creator and minute; a retry counts too. */
export const BROADCAST_RATE_LIMIT = { limit: 10, windowSeconds: 60 } as const;

export interface CreateBroadcastInput {
  clientBroadcastId: string;
  assetId: string;
  /** Already trimmed; absent = media only. */
  body?: string | undefined;
  saveToGallery: boolean;
}

export interface BroadcastRecord {
  id: string;
  status: 'QUEUED' | 'FANNING_OUT' | 'COMPLETED';
  createdAt: Date;
}

export type CreateBroadcastOutcome =
  | { kind: 'created' | 'replayed'; broadcast: BroadcastRecord }
  | { kind: 'invalid' }
  /** Not a creator, or the creator or the creator's account is not ACTIVE. */
  | { kind: 'not_found' }
  /** Unknown, malformed, another creator's, or a file that cannot be broadcast. */
  | { kind: 'media_not_found' }
  | { kind: 'media_not_ready' }
  | { kind: 'no_active_subscribers' }
  /** The same client id was used for a different broadcast. */
  | { kind: 'conflict' }
  | { kind: 'rate_limited'; retryAfterSeconds: number };

interface AssetRow {
  state: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  purpose: 'GALLERY' | 'CHAT' | 'BROADCAST' | 'WELCOME';
  in_gallery: boolean;
  used: boolean;
}

/**
 * A creator records a broadcast (US-038): one photo or video and an optional text for every active
 * subscriber. Recording is all this does; the worker snapshots the recipients and writes the
 * messages (US-039). One transaction: the creator row is locked first (so two requests of one creator
 * run one after the other), then the asset row, so an unsent-upload cleanup cannot delete a file that
 * is being broadcast. The outbox event carries ids only.
 */
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly clock: () => Date = () => new Date(),
    /** Absent in tests that do not need it; throws `RateLimiterUnavailableError` when Redis is down. */
    private readonly limiter: FixedWindowLimiter | null = null,
  ) {}

  async create(
    creatorUserId: string,
    input: CreateBroadcastInput,
  ): Promise<CreateBroadcastOutcome> {
    const body = input.body ?? null;
    if (body !== null && (body.length === 0 || [...body].length > BODY_MAX)) {
      return { kind: 'invalid' };
    }
    if (!UUID.test(input.clientBroadcastId)) return { kind: 'invalid' };
    if (!UUID.test(input.assetId)) return { kind: 'media_not_found' };

    if (this.limiter) {
      const verdict = await this.limiter.hit(
        `creator:${creatorUserId}`,
        BROADCAST_RATE_LIMIT.limit,
        BROADCAST_RATE_LIMIT.windowSeconds,
      );
      if (!verdict.allowed) {
        return { kind: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds };
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const now = this.clock();
      const [creator] = await tx.$queryRaw<{ id: string }[]>`
        SELECT cr.id::text AS id FROM creators cr
        JOIN users ou ON ou.id = cr.user_id
        WHERE cr.user_id = ${creatorUserId}::uuid AND cr.status = 'ACTIVE'
          AND ou.status = 'ACTIVE' AND ou.role = 'CREATOR'
        FOR UPDATE OF cr`;
      if (!creator) return { kind: 'not_found' } as const;

      // A retry returns the stored broadcast, before any other check (the subscribers may have
      // changed since the first request).
      const existing = await tx.broadcast.findUnique({
        where: {
          creatorId_clientBroadcastId: {
            creatorId: creator.id,
            clientBroadcastId: input.clientBroadcastId,
          },
        },
      });
      if (existing) {
        const same =
          existing.assetId === input.assetId &&
          existing.body === body &&
          existing.saveToGallery === input.saveToGallery;
        return same
          ? ({ kind: 'replayed', broadcast: toRecord(existing) } as const)
          : ({ kind: 'conflict' } as const);
      }

      // The creator is part of the statement: another creator's asset looks like an unknown one.
      const [asset] = await tx.$queryRaw<AssetRow[]>`
        SELECT a.state::text AS state, a.purpose::text AS purpose,
               EXISTS (SELECT 1 FROM gallery_items g WHERE g.asset_id = a.id) AS in_gallery,
               EXISTS (SELECT 1 FROM broadcasts b WHERE b.asset_id = a.id) AS used
        FROM media_assets a
        WHERE a.id = ${input.assetId}::uuid AND a.creator_id = ${creator.id}::uuid
        FOR UPDATE OF a`;
      if (!asset) return { kind: 'media_not_found' } as const;
      if (asset.purpose === 'GALLERY') {
        if (!asset.in_gallery || asset.state !== 'READY')
          return { kind: 'media_not_found' } as const;
      } else if (asset.purpose === 'BROADCAST') {
        if (asset.state === 'PENDING' || asset.state === 'PROCESSING') {
          return { kind: 'media_not_ready' } as const;
        }
        // An upload belongs to one broadcast; a gallery file may be broadcast again.
        if (asset.state !== 'READY' || asset.used) return { kind: 'media_not_found' } as const;
      } else {
        return { kind: 'media_not_found' } as const;
      }
      // A gallery file is already in the gallery, so the box only makes sense for an upload.
      if (input.saveToGallery && asset.purpose !== 'BROADCAST') return { kind: 'invalid' } as const;

      const [{ n } = { n: 0 }] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${ENTITLED_FROM}
        WHERE s.creator_id = ${creator.id}::uuid AND ${entitledSubscriptionSql(now)}`;
      if (n === 0) return { kind: 'no_active_subscribers' } as const;

      if (input.saveToGallery && !asset.in_gallery) {
        await addToGallery(tx, creator.id, input.assetId);
      }
      const row = await tx.broadcast.create({
        data: {
          creatorId: creator.id,
          clientBroadcastId: input.clientBroadcastId,
          assetId: input.assetId,
          body,
          saveToGallery: input.saveToGallery,
          createdAt: now,
        },
      });
      await this.outbox.add(tx, {
        type: OutboxEventType.BROADCAST_CREATED,
        aggregateType: 'broadcast',
        aggregateId: row.id,
        payload: { broadcast_id: row.id, creator_id: creator.id },
        dedupeKey: `broadcast:${row.id}:created`,
      });
      return { kind: 'created', broadcast: toRecord(row) } as const;
    });
  }
}

function toRecord(row: {
  id: string;
  status: BroadcastRecord['status'];
  createdAt: Date;
}): BroadcastRecord {
  return { id: row.id, status: row.status, createdAt: row.createdAt };
}
