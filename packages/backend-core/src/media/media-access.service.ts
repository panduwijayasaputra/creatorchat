import type { PrismaClient } from '@creatorchat/db';
import { Prisma } from '@creatorchat/db';
import { ENTITLED_FROM, entitledSubscriptionSql } from '../subscription-access/entitlement-sql.js';
import type { ObjectStorage } from './storage/object-storage.js';

/** Thumbnails in lists live 15 minutes; originals only 5. */
export const THUMBNAIL_URL_SECONDS = 15 * 60;
export const ORIGINAL_URL_SECONDS = 5 * 60;

/**
 * The only place that turns a stored object into a link someone can open (backend.md rule 6). Links
 * are issued after an ownership check, are short-lived and never name a permanent location.
 * US-032 knows the owner; the subscriber, recipient and admin paths join this service later.
 */
export class MediaAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
  ) {}

  /**
   * Signed thumbnail links for READY assets of the creator behind `userId`, keyed by asset id.
   * One ownership query covers the whole batch; an asset that is not theirs gets no link.
   */
  async thumbnailUrlsForOwner(
    userId: string,
    assets: { id: string; thumbKey: string | null }[],
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const candidates = assets.filter((a) => a.thumbKey !== null);
    if (candidates.length === 0) return urls;
    const ids = candidates.map((a) => a.id);
    const owned = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id FROM media_assets a
      JOIN creators c ON c.id = a.creator_id
      WHERE a.id = ANY(${ids}::uuid[]) AND c.user_id = ${userId}::uuid AND a.state = 'READY'`;
    const mine = new Set(owned.map((r) => r.id));
    for (const asset of candidates) {
      if (!mine.has(asset.id) || asset.thumbKey === null) continue;
      urls.set(
        asset.id,
        await this.storage.presignGet(asset.thumbKey, {
          expiresInSeconds: THUMBNAIL_URL_SECONDS,
          contentType: 'image/webp',
        }),
      );
    }
    return urls;
  }

  /**
   * A 5-minute link to the file of a READY asset of the creator behind `userId`; `null` when the
   * asset is not theirs or not READY. The content type is the verified `mime`.
   */
  async originalUrlForOwner(
    userId: string,
    asset: { id: string; objectKey: string; mime: string | null },
    now: Date = new Date(),
  ): Promise<{ url: string; expiresAt: Date } | null> {
    const [owned] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id FROM media_assets a
      JOIN creators c ON c.id = a.creator_id
      WHERE a.id = ${asset.id}::uuid AND c.user_id = ${userId}::uuid AND a.state = 'READY'`;
    if (!owned) return null;
    const url = await this.storage.presignGet(asset.objectKey, {
      expiresInSeconds: ORIGINAL_URL_SECONDS,
      ...(asset.mime ? { contentType: asset.mime } : {}),
    });
    return { url, expiresAt: new Date(now.getTime() + ORIGINAL_URL_SECONDS * 1000) };
  }

  /**
   * The SQL condition "this customer has active access to the creator of asset alias `a`": the one
   * entitlement rule (brief §6), evaluated again every time a link is issued.
   */
  private entitledTo(userId: string, now: Date): Prisma.Sql {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM ${ENTITLED_FROM}
      WHERE s.customer_id = ${userId}::uuid AND s.creator_id = a.creator_id
        AND ${entitledSubscriptionSql(now)})`;
  }

  /**
   * Signed thumbnail links for gallery items a subscriber may see: READY, in the creator's gallery,
   * and the customer is entitled to that creator right now. Anything else gets no link.
   */
  async thumbnailUrlsForSubscriber(
    userId: string,
    assets: { id: string; thumbKey: string | null }[],
    now: Date = new Date(),
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const candidates = assets.filter((a) => a.thumbKey !== null);
    if (candidates.length === 0) return urls;
    const ids = candidates.map((a) => a.id);
    const allowed = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id FROM media_assets a
      JOIN gallery_items g ON g.asset_id = a.id
      WHERE a.id = ANY(${ids}::uuid[]) AND a.state = 'READY' AND ${this.entitledTo(userId, now)}`;
    const ok = new Set(allowed.map((r) => r.id));
    for (const asset of candidates) {
      if (!ok.has(asset.id) || asset.thumbKey === null) continue;
      urls.set(
        asset.id,
        await this.storage.presignGet(asset.thumbKey, {
          expiresInSeconds: THUMBNAIL_URL_SECONDS,
          contentType: 'image/webp',
        }),
      );
    }
    return urls;
  }

  /** A 5-minute link to a gallery item's file for an entitled subscriber; `null` otherwise. */
  async originalUrlForSubscriber(
    userId: string,
    asset: { id: string; objectKey: string; mime: string | null },
    now: Date = new Date(),
  ): Promise<{ url: string; expiresAt: Date } | null> {
    const [allowed] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id FROM media_assets a
      JOIN gallery_items g ON g.asset_id = a.id
      WHERE a.id = ${asset.id}::uuid AND a.state = 'READY' AND ${this.entitledTo(userId, now)}`;
    if (!allowed) return null;
    const url = await this.storage.presignGet(asset.objectKey, {
      expiresInSeconds: ORIGINAL_URL_SECONDS,
      ...(asset.mime ? { contentType: asset.mime } : {}),
    });
    return { url, expiresAt: new Date(now.getTime() + ORIGINAL_URL_SECONDS * 1000) };
  }

  /**
   * Signed thumbnail links for the admin view of one creator's gallery: only READY assets that are
   * gallery items of exactly that creator get a link, whatever ids are passed in.
   */
  async thumbnailUrlsForAdmin(
    creatorId: string,
    assets: { id: string; thumbKey: string | null }[],
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const candidates = assets.filter((a) => a.thumbKey !== null);
    if (candidates.length === 0) return urls;
    const ids = candidates.map((a) => a.id);
    const allowed = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id FROM media_assets a
      JOIN gallery_items g ON g.asset_id = a.id AND g.creator_id = ${creatorId}::uuid
      WHERE a.id = ANY(${ids}::uuid[]) AND a.state = 'READY' AND a.creator_id = ${creatorId}::uuid`;
    const ok = new Set(allowed.map((r) => r.id));
    for (const asset of candidates) {
      if (!ok.has(asset.id) || asset.thumbKey === null) continue;
      urls.set(
        asset.id,
        await this.storage.presignGet(asset.thumbKey, {
          expiresInSeconds: THUMBNAIL_URL_SECONDS,
          contentType: 'image/webp',
        }),
      );
    }
    return urls;
  }

  /** A 5-minute link to a gallery item's file for an admin; `null` unless it is a READY gallery item of that creator. */
  async originalUrlForAdmin(
    creatorId: string,
    asset: { id: string; objectKey: string; mime: string | null },
    now: Date = new Date(),
  ): Promise<{ url: string; expiresAt: Date } | null> {
    const [allowed] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id::text AS id FROM media_assets a
      JOIN gallery_items g ON g.asset_id = a.id AND g.creator_id = ${creatorId}::uuid
      WHERE a.id = ${asset.id}::uuid AND a.state = 'READY' AND a.creator_id = ${creatorId}::uuid`;
    if (!allowed) return null;
    const url = await this.storage.presignGet(asset.objectKey, {
      expiresInSeconds: ORIGINAL_URL_SECONDS,
      ...(asset.mime ? { contentType: asset.mime } : {}),
    });
    return { url, expiresAt: new Date(now.getTime() + ORIGINAL_URL_SECONDS * 1000) };
  }

  /**
   * Signed thumbnail links for the files of messages in conversations `userId` takes part in (as the
   * customer, or as the creator): the recipient rule of brief §8E. It does not look at access dates:
   * a file received in a chat stays readable after the access ended. Anything not attached to a
   * message of such a conversation gets no link.
   */
  async thumbnailUrlsForParticipant(
    userId: string,
    assets: { id: string; thumbKey: string | null }[],
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const candidates = assets.filter((a) => a.thumbKey !== null);
    if (candidates.length === 0) return urls;
    const ids = candidates.map((a) => a.id);
    const allowed = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT a.id::text AS id FROM media_assets a
      JOIN message_attachments ma ON ma.asset_id = a.id
      JOIN messages m ON m.id = ma.message_id
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN creators cr ON cr.id = c.creator_id
      WHERE a.id = ANY(${ids}::uuid[]) AND a.state = 'READY'
        AND (c.customer_id = ${userId}::uuid OR cr.user_id = ${userId}::uuid)`;
    const ok = new Set(allowed.map((r) => r.id));
    for (const asset of candidates) {
      if (!ok.has(asset.id) || asset.thumbKey === null) continue;
      urls.set(
        asset.id,
        await this.storage.presignGet(asset.thumbKey, {
          expiresInSeconds: THUMBNAIL_URL_SECONDS,
          contentType: 'image/webp',
        }),
      );
    }
    return urls;
  }

  /**
   * A 5-minute link to a file that is attached to a message in a conversation `userId` takes part in
   * (brief §8E, the recipient rule): no look at access dates, so a received file stays readable after
   * expiry. `null` for anything else.
   */
  async originalUrlForParticipant(
    userId: string,
    asset: { id: string; objectKey: string; mime: string | null },
    now: Date = new Date(),
  ): Promise<{ url: string; expiresAt: Date } | null> {
    const [allowed] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT a.id::text AS id FROM media_assets a
      JOIN message_attachments ma ON ma.asset_id = a.id
      JOIN messages m ON m.id = ma.message_id
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN creators cr ON cr.id = c.creator_id
      WHERE a.id = ${asset.id}::uuid AND a.state = 'READY'
        AND (c.customer_id = ${userId}::uuid OR cr.user_id = ${userId}::uuid)`;
    if (!allowed) return null;
    const url = await this.storage.presignGet(asset.objectKey, {
      expiresInSeconds: ORIGINAL_URL_SECONDS,
      ...(asset.mime ? { contentType: asset.mime } : {}),
    });
    return { url, expiresAt: new Date(now.getTime() + ORIGINAL_URL_SECONDS * 1000) };
  }
}
