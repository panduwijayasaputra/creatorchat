import { randomUUID } from 'node:crypto';
import type { MediaFailure } from '@creatorchat/contracts';
import { Prisma, type MediaAsset, type PrismaClient } from '@creatorchat/db';
import { OutboxEventType, type OutboxService } from '../outbox/outbox.service.js';
import type { FixedWindowLimiter } from '../user-auth/rate-limiter.js';
import type { MediaAccessService } from './media-access.service.js';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';
import { locateGalleryItem, pageGallery } from './gallery-queries.js';
import { sniffMediaType } from './sniff.js';
import type { ObjectStorage, PresignedPut } from './storage/object-storage.js';

/** Why an upload cannot be used; the same codes the API reports. */
export type MediaFailureCode = MediaFailure;

export interface MediaLimits {
  photoMaxBytes: number;
  videoMaxBytes: number;
  videoMaxSeconds: number;
}

/** A client-safe description of an asset: no storage key, no internal columns. */
export interface MediaAssetSummary {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  state: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  failure: MediaFailure | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  createdAt: Date;
}

export type InitOutcome =
  | { kind: 'created' | 'replayed'; asset: MediaAssetSummary; upload: PresignedPut | null }
  | { kind: 'not_creator' }
  | { kind: 'creator_not_active' }
  | { kind: 'type_not_allowed' }
  | { kind: 'too_large' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  /** CHAT uploads: the conversation is not the creator's, or does not exist. */
  | { kind: 'conversation_not_found' }
  /** CHAT uploads: the customer no longer has active access, so nothing may be parked in the chat. */
  | { kind: 'chat_access_expired' };

export type CompleteOutcome =
  { kind: 'ok'; asset: MediaAssetSummary } | { kind: 'not_found' } | { kind: 'incomplete' };

export type GetOutcome = { kind: 'ok'; asset: MediaAssetSummary } | { kind: 'not_found' };

export type GalleryOutcome =
  | {
      kind: 'ok';
      items: { asset: MediaAssetSummary; addedAt: Date }[];
      total: number;
      nextCursor: string | null;
    }
  | { kind: 'not_creator' }
  | { kind: 'invalid_cursor' };

export type GalleryItemOutcome =
  | {
      kind: 'ok';
      asset: MediaAssetSummary;
      original: { url: string; expiresAt: Date };
      uploadedAt: Date;
      position: number;
      total: number;
      previousId: string | null;
      nextId: string | null;
    }
  | { kind: 'not_found' };

export interface ProcessedMedia {
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  thumbKey: string;
}

export interface MediaUploadDeps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  outbox: OutboxService;
  limiter: FixedWindowLimiter;
  access: MediaAccessService;
  limits: MediaLimits;
  clock?: () => Date;
}

/** Presigned PUT links live 15 minutes. */
export const UPLOAD_URL_SECONDS = 15 * 60;
/** 30 `init` calls per creator per 10 minutes. */
export const INIT_RATE_LIMIT = { limit: 30, windowSeconds: 600 } as const;
/** Abandoned (PENDING) and FAILED uploads are cleaned up after a day. */
export const CLEANUP_AFTER_MS = 24 * 3_600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

const thumbKeyOf = (objectKey: string) => `${objectKey}/thumb.webp`;

/**
 * Creator uploads and the gallery listing (US-032), plus the worker's commit and cleanup steps.
 * Every query that takes a caller-supplied id is scoped to the creator behind the session, so another
 * creator's id looks like an unknown one. Storage keys are made here and never leave this class.
 */
export class MediaUploadService {
  private readonly clock: () => Date;

  constructor(private readonly deps: MediaUploadDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  limits(): MediaLimits {
    return this.deps.limits;
  }

  async init(
    userId: string,
    body: {
      clientUploadId: string;
      kind: 'PHOTO' | 'VIDEO';
      contentType: string;
      sizeBytes: number;
      /** `CHAT` = "Upload Baru" in a conversation (US-036): never in the gallery. */
      purpose?: 'GALLERY' | 'CHAT';
      conversationId?: string | undefined;
    },
  ): Promise<InitOutcome> {
    const { prisma, storage } = this.deps;
    const creator = await prisma.creator.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (!creator) return { kind: 'not_creator' };
    if (creator.status !== 'ACTIVE') return { kind: 'creator_not_active' };

    const verdict = await this.deps.limiter.hit(
      `creator:${creator.id}`,
      INIT_RATE_LIMIT.limit,
      INIT_RATE_LIMIT.windowSeconds,
    );
    if (!verdict.allowed)
      return { kind: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds };

    const allowed = body.kind === 'PHOTO' ? PHOTO_TYPES : VIDEO_TYPES;
    if (!allowed.has(body.contentType)) return { kind: 'type_not_allowed' };
    const max =
      body.kind === 'PHOTO' ? this.deps.limits.photoMaxBytes : this.deps.limits.videoMaxBytes;
    if (body.sizeBytes <= 0 || body.sizeBytes > max) return { kind: 'too_large' };

    const purpose = body.purpose ?? 'GALLERY';
    if (purpose === 'CHAT') {
      const conversationId = body.conversationId ?? '';
      if (!UUID.test(conversationId)) return { kind: 'conversation_not_found' };
      const [conv] = await prisma.$queryRaw<{ entitled: boolean }[]>`
        SELECT EXISTS (
                 SELECT 1 FROM ${ENTITLED_FROM}
                 WHERE s.customer_id = c.customer_id AND s.creator_id = c.creator_id
                   AND ${entitledSubscriptionSql(this.clock())}) AS entitled
        FROM conversations c
        WHERE c.id = ${conversationId}::uuid AND c.creator_id = ${creator.id}::uuid`;
      if (!conv) return { kind: 'conversation_not_found' };
      if (!conv.entitled) return { kind: 'chat_access_expired' };
    }

    const id = randomUUID();
    let row: MediaAsset;
    let created = true;
    try {
      row = await prisma.mediaAsset.create({
        data: {
          id,
          creatorId: creator.id,
          clientUploadId: body.clientUploadId,
          purpose,
          ...(purpose === 'CHAT' && body.conversationId
            ? { conversationId: body.conversationId }
            : {}),
          kind: body.kind,
          objectKey: `m/${creator.id}/${id}`,
          declaredType: body.contentType,
          declaredBytes: BigInt(body.sizeBytes),
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      created = false;
      row = await prisma.mediaAsset.findFirstOrThrow({
        where: { creatorId: creator.id, clientUploadId: body.clientUploadId },
      });
    }

    const upload =
      row.state === 'PENDING'
        ? await storage.presignPut(row.objectKey, {
            contentType: row.declaredType,
            contentLength: Number(row.declaredBytes),
            expiresInSeconds: UPLOAD_URL_SECONDS,
          })
        : null;
    const [asset] = await this.summaries(userId, [row]);
    return { kind: created ? 'created' : 'replayed', asset: asset as MediaAssetSummary, upload };
  }

  /**
   * Verifies what was uploaded (size, then the real file type from its first bytes) and hands it to
   * the worker. Locks the asset row, so two concurrent calls write one outbox event. Anything but
   * PENDING returns as it is.
   */
  async complete(userId: string, assetId: string): Promise<CompleteOutcome> {
    const { storage } = this.deps;
    const orphans: string[] = [];
    const outcome = await this.deps.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; state: string }[]>`
        SELECT a.id::text AS id, a.state::text AS state
        FROM media_assets a JOIN creators c ON c.id = a.creator_id
        WHERE a.id = ${assetId}::uuid AND c.user_id = ${userId}::uuid
        FOR UPDATE OF a`;
      if (!locked) return { kind: 'not_found' } as const;
      const row = await tx.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
      if (row.state !== 'PENDING') return { kind: 'ok', row } as const;

      const head = await storage.head(row.objectKey);
      if (!head) return { kind: 'incomplete' } as const;

      const fail = async (code: MediaFailure) => {
        orphans.push(row.objectKey);
        return {
          kind: 'ok',
          row: await tx.mediaAsset.update({
            where: { id: row.id },
            data: { state: 'FAILED', failureCode: code },
          }),
        } as const;
      };
      if (BigInt(head.size) !== row.declaredBytes) {
        return fail(BigInt(head.size) > row.declaredBytes ? 'TOO_LARGE' : 'UNREADABLE');
      }
      const sniffed = sniffMediaType(await storage.readRange(row.objectKey, 0, 63));
      if (!sniffed || sniffed.kind !== row.kind) return fail('TYPE_NOT_ALLOWED');

      const now = this.clock();
      await this.deps.outbox.add(tx, {
        type: OutboxEventType.MEDIA_UPLOADED,
        aggregateType: 'media_asset',
        aggregateId: row.id,
        payload: { asset_id: row.id },
        dedupeKey: `media:${row.id}:uploaded`,
      });
      return {
        kind: 'ok',
        row: await tx.mediaAsset.update({
          where: { id: row.id },
          data: { state: 'PROCESSING', mime: sniffed.mime, uploadedAt: now },
        }),
      } as const;
    });
    await this.deleteQuietly(orphans);
    if (outcome.kind !== 'ok') return outcome;
    const [asset] = await this.summaries(userId, [outcome.row]);
    return { kind: 'ok', asset: asset as MediaAssetSummary };
  }

  async get(userId: string, assetId: string): Promise<GetOutcome> {
    const row = await this.deps.prisma.mediaAsset.findFirst({
      where: { id: assetId, creator: { userId } },
    });
    if (!row) return { kind: 'not_found' };
    const [asset] = await this.summaries(userId, [row]);
    return { kind: 'ok', asset: asset as MediaAssetSummary };
  }

  /** READY gallery items of my creator, newest first (`seq` descending), keyset-paged. */
  async listGallery(
    userId: string,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<GalleryOutcome> {
    const { prisma } = this.deps;
    const creator = await prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) return { kind: 'not_creator' };
    const result = await pageGallery(prisma, creator.id, query);
    if (result.kind === 'invalid_cursor') return result;
    const { rows: page, total, nextCursor } = result;
    const summaries = await this.summaries(
      userId,
      page.map((g) => g.asset),
    );
    return {
      kind: 'ok',
      items: page.map((g, i) => ({ asset: summaries[i] as MediaAssetSummary, addedAt: g.addedAt })),
      total,
      nextCursor,
    };
  }

  /**
   * One item of my gallery for the viewer: the file link (5 minutes), its place (1 = newest) and the
   * neighbouring items. Not mine, not READY, not in the gallery, unknown: all `not_found`.
   */
  async galleryItemForOwner(userId: string, assetId: string): Promise<GalleryItemOutcome> {
    const { prisma } = this.deps;
    const creator = await prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) return { kind: 'not_found' };
    const found = await locateGalleryItem(prisma, creator.id, assetId);
    if (!found) return { kind: 'not_found' };
    const item = found.row;
    const original = await this.deps.access.originalUrlForOwner(userId, item.asset, this.clock());
    if (!original) return { kind: 'not_found' };
    const [asset] = await this.summaries(userId, [item.asset]);
    return {
      kind: 'ok',
      asset: asset as MediaAssetSummary,
      original,
      uploadedAt: item.addedAt,
      position: found.position,
      total: found.total,
      previousId: found.previousId,
      nextId: found.nextId,
    };
  }

  /**
   * Worker: the file was verified and cleaned. In one transaction the asset becomes READY and joins
   * the gallery with the creator's next media number. Run twice, the second call changes nothing.
   */
  async markProcessed(assetId: string, meta: ProcessedMedia): Promise<'READY' | 'SKIPPED'> {
    return this.deps.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ creator_id: string; state: string; purpose: string }[]>`
        SELECT creator_id::text AS creator_id, state::text AS state, purpose::text AS purpose
        FROM media_assets WHERE id = ${assetId}::uuid FOR UPDATE`;
      if (!locked || locked.state !== 'PROCESSING') return 'SKIPPED';
      // A chat-only upload becomes READY without a gallery item or a media number.
      if (locked.purpose === 'GALLERY') {
        const [counter] = await tx.$queryRaw<{ seq: number }[]>`
          UPDATE creators SET last_gallery_seq = last_gallery_seq + 1
          WHERE id = ${locked.creator_id}::uuid RETURNING last_gallery_seq AS seq`;
        await tx.$executeRaw`
          INSERT INTO gallery_items (creator_id, asset_id, seq)
          VALUES (${locked.creator_id}::uuid, ${assetId}::uuid, ${counter?.seq ?? 1})
          ON CONFLICT (creator_id, asset_id) DO NOTHING`;
      }
      await tx.mediaAsset.update({
        where: { id: assetId },
        data: {
          state: 'READY',
          mime: meta.mime,
          sizeBytes: BigInt(meta.sizeBytes),
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          thumbKey: meta.thumbKey,
          failureCode: null,
          readyAt: this.clock(),
        },
      });
      return 'READY';
    });
  }

  /** Worker: the file cannot be used. Its objects are deleted after the state is saved. */
  async markFailed(assetId: string, code: MediaFailure): Promise<void> {
    const keys = await this.deps.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ object_key: string; state: string }[]>`
        SELECT object_key, state::text AS state FROM media_assets
        WHERE id = ${assetId}::uuid FOR UPDATE`;
      if (!locked || (locked.state !== 'PROCESSING' && locked.state !== 'PENDING')) return [];
      await tx.mediaAsset.update({
        where: { id: assetId },
        data: { state: 'FAILED', failureCode: code },
      });
      return [locked.object_key, thumbKeyOf(locked.object_key)];
    });
    await this.deleteQuietly(keys);
  }

  /**
   * Removes abandoned (PENDING) and FAILED uploads older than a day, and chat uploads that were never
   * sent (READY for a day, no attachment), objects first and then the row, each under the row lock.
   * A send locks the same row and re-checks, so an attached file can never be removed; gallery assets
   * are never touched.
   */
  async cleanup(now: Date = this.clock(), batch = 100): Promise<number> {
    const cutoff = new Date(now.getTime() - CLEANUP_AFTER_MS);
    const candidates = await this.deps.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM media_assets
      WHERE (state = 'PENDING' AND created_at < ${cutoff}::timestamptz)
         OR (state = 'FAILED' AND updated_at < ${cutoff}::timestamptz)
         OR (purpose = 'CHAT' AND state = 'READY' AND ready_at < ${cutoff}::timestamptz
             AND NOT EXISTS (SELECT 1 FROM message_attachments x WHERE x.asset_id = media_assets.id))
      ORDER BY created_at LIMIT ${batch}`;
    let removed = 0;
    for (const { id } of candidates) {
      const done = await this.deps.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ object_key: string }[]>`
          SELECT object_key FROM media_assets
          WHERE id = ${id}::uuid
            AND ((state = 'PENDING' AND created_at < ${cutoff}::timestamptz)
              OR (state = 'FAILED' AND updated_at < ${cutoff}::timestamptz)
              OR (purpose = 'CHAT' AND state = 'READY' AND ready_at < ${cutoff}::timestamptz
                  AND NOT EXISTS (SELECT 1 FROM message_attachments x WHERE x.asset_id = media_assets.id)))
          FOR UPDATE SKIP LOCKED`;
        if (!row) return false;
        await this.deps.storage.delete(row.object_key);
        await this.deps.storage.delete(thumbKeyOf(row.object_key));
        await tx.$executeRaw`DELETE FROM media_assets WHERE id = ${id}::uuid`;
        return true;
      });
      if (done) removed += 1;
    }
    return removed;
  }

  private async deleteQuietly(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.deps.storage.delete(key);
      } catch {
        // The row is FAILED; cleanup() retries the deletion.
      }
    }
  }

  private async summaries(userId: string, rows: MediaAsset[]): Promise<MediaAssetSummary[]> {
    const urls = await this.deps.access.thumbnailUrlsForOwner(
      userId,
      rows.filter((r) => r.state === 'READY').map((r) => ({ id: r.id, thumbKey: r.thumbKey })),
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      state: r.state,
      failure: (r.failureCode as MediaFailure | null) ?? null,
      durationSeconds: r.durationMs === null ? null : Math.round(r.durationMs / 1000),
      thumbnailUrl: urls.get(r.id) ?? null,
      createdAt: r.createdAt,
    }));
  }
}
