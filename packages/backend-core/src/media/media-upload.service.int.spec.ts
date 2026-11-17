import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { FixedWindowLimiter, type RateLimiterRedis } from '../user-auth/rate-limiter.js';
import { MediaAccessService } from './media-access.service.js';
import { CLEANUP_AFTER_MS, MediaUploadService } from './media-upload.service.js';
import { LocalDiskStorage } from './storage/local-disk-storage.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let dir: string;
let storage: LocalDiskStorage;
let service: MediaUploadService;
let now = new Date('2026-11-18T10:00:00.000Z');

/** Counters in memory: the limiter only needs four Redis commands. */
function fakeRedis(): RateLimiterRedis {
  const values = new Map<string, number>();
  return {
    get: async (k) => (values.has(k) ? String(values.get(k)) : null),
    incr: async (k) => {
      values.set(k, (values.get(k) ?? 0) + 1);
      return values.get(k) as number;
    },
    ttl: async () => 600,
    set: async (k, v, _m, _s, flag) => {
      if (flag === 'NX' && values.has(k)) return null;
      values.set(k, Number(v));
      return 'OK';
    },
  };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(996, 1)]); // 1000 B
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(1000 - 12, 2),
]);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-media-'));
  storage = new LocalDiskStorage(dir, 's'.repeat(40), 'http://api.test', () => now);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

let n = 98_000n;
let codeNo = 0;
beforeEach(async () => {
  now = new Date('2026-11-18T10:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
  service = new MediaUploadService({
    prisma,
    storage,
    outbox: new OutboxService(),
    limiter: new FixedWindowLimiter(fakeRedis(), 'test:media:init'),
    access: new MediaAccessService(prisma, storage),
    limits: { photoMaxBytes: 5000, videoMaxBytes: 20_000, videoMaxSeconds: 300 },
    clock: () => now,
  });
});

async function makeCreator(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: `ccccccc${'abcdefgh'[codeNo++]}`, status },
  });
  return { user, creator };
}

const initBody = (over: Record<string, unknown> = {}) => ({
  clientUploadId: randomUUID(),
  kind: 'PHOTO' as const,
  contentType: 'image/jpeg',
  sizeBytes: 1000,
  ...over,
});

async function put(assetId: string, bytes: Buffer) {
  const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
  const source = path.join(dir, `src-${randomUUID()}`);
  await writeFile(source, bytes);
  await storage.upload(row.objectKey, source, row.declaredType);
  return row.objectKey;
}

async function initOk(userId: string, over: Record<string, unknown> = {}) {
  const r = await service.init(userId, initBody(over));
  if (r.kind !== 'created' && r.kind !== 'replayed') throw new Error(`init: ${r.kind}`);
  return r;
}

const outboxRows = () => prisma.outboxEvent.findMany({ where: { type: 'media.uploaded' } });

describe('MediaUploadService.init', () => {
  it('stores a PENDING asset and returns a presigned PUT, with no storage key in the view', async () => {
    const { user } = await makeCreator();
    const r = await initOk(user.id);
    expect(r.kind).toBe('created');
    expect(r.asset).toMatchObject({ kind: 'PHOTO', state: 'PENDING', thumbnailUrl: null });
    expect(r.upload?.method).toBe('PUT');
    expect(r.upload?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(r.upload?.expiresAt.getTime()).toBe(now.getTime() + 15 * 60_000);
    expect(JSON.stringify(r.asset)).not.toMatch(/m\/|object|key/i);
  });

  it('a repeated client_upload_id returns the same asset with a fresh URL', async () => {
    const { user } = await makeCreator();
    const clientUploadId = randomUUID();
    const a = await initOk(user.id, { clientUploadId });
    now = new Date(now.getTime() + 60_000);
    const b = await initOk(user.id, { clientUploadId });
    expect(b.kind).toBe('replayed');
    expect(b.asset.id).toBe(a.asset.id);
    expect(b.upload?.url).not.toBe(a.upload?.url);
    expect(await prisma.mediaAsset.count()).toBe(1);
  });

  it('replaying a finished asset returns it without an upload URL', async () => {
    const { user } = await makeCreator();
    const clientUploadId = randomUUID();
    const a = await initOk(user.id, { clientUploadId });
    await put(a.asset.id, JPEG);
    await service.complete(user.id, a.asset.id);
    const again = await initOk(user.id, { clientUploadId });
    expect(again.asset.state).toBe('PROCESSING');
    expect(again.upload).toBeNull();
  });

  it('another creator using the same client_upload_id gets a separate asset', async () => {
    const a = await makeCreator();
    const b = await makeCreator();
    const clientUploadId = randomUUID();
    const x = await initOk(a.user.id, { clientUploadId });
    const y = await initOk(b.user.id, { clientUploadId });
    expect(y.kind).toBe('created');
    expect(y.asset.id).not.toBe(x.asset.id);
  });

  it('refuses a type that does not match the kind and a size over the limit, storing nothing', async () => {
    const { user } = await makeCreator();
    expect(await service.init(user.id, initBody({ contentType: 'video/mp4' }))).toEqual({
      kind: 'type_not_allowed',
    });
    expect(await service.init(user.id, initBody({ sizeBytes: 5001 }))).toEqual({
      kind: 'too_large',
    });
    expect(
      await service.init(
        user.id,
        initBody({ kind: 'VIDEO', contentType: 'video/mp4', sizeBytes: 20_001 }),
      ),
    ).toEqual({ kind: 'too_large' });
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it('refuses a blocked creator and a user who is not a creator', async () => {
    const blocked = await makeCreator('BLOCKED');
    expect(await service.init(blocked.user.id, initBody())).toEqual({ kind: 'creator_not_active' });
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
    expect(await service.init(customer.id, initBody())).toEqual({ kind: 'not_creator' });
  });

  it('allows 30 inits per window and refuses the 31st', async () => {
    const { user } = await makeCreator();
    for (let i = 0; i < 30; i++)
      expect((await service.init(user.id, initBody())).kind).toBe('created');
    const last = await service.init(user.id, initBody());
    expect(last).toEqual({ kind: 'rate_limited', retryAfterSeconds: 600 });
    expect(await prisma.mediaAsset.count()).toBe(30);
  });
});

describe('MediaUploadService.complete', () => {
  it('answers incomplete and keeps PENDING when nothing was uploaded', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    expect(await service.complete(user.id, a.asset.id)).toEqual({ kind: 'incomplete' });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: a.asset.id } });
    expect(row.state).toBe('PENDING');
    expect(await outboxRows()).toHaveLength(0);
  });

  it('fails a file whose bytes are not a photo and deletes the object', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    const key = await put(a.asset.id, Buffer.alloc(1000, 0x41)); // right size, wrong magic
    const r = await service.complete(user.id, a.asset.id);
    expect(r).toMatchObject({
      kind: 'ok',
      asset: { state: 'FAILED', failure: 'TYPE_NOT_ALLOWED' },
    });
    expect(await storage.head(key)).toBeNull();
    expect(await outboxRows()).toHaveLength(0);
  });

  it('fails a photo upload that is really a video', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    await put(a.asset.id, MP4);
    const r = await service.complete(user.id, a.asset.id);
    expect(r).toMatchObject({ asset: { state: 'FAILED', failure: 'TYPE_NOT_ALLOWED' } });
  });

  it('fails a file whose size differs from the declared size', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    await put(a.asset.id, JPEG.subarray(0, 500));
    expect(await service.complete(user.id, a.asset.id)).toMatchObject({
      asset: { state: 'FAILED', failure: 'UNREADABLE' },
    });
    const b = await initOk(user.id);
    await put(b.asset.id, Buffer.concat([JPEG, JPEG]));
    expect(await service.complete(user.id, b.asset.id)).toMatchObject({
      asset: { state: 'FAILED', failure: 'TOO_LARGE' },
    });
  });

  it('moves a good upload to PROCESSING with exactly one outbox event, also when called twice', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    await put(a.asset.id, JPEG);
    const first = await service.complete(user.id, a.asset.id);
    expect(first).toMatchObject({ kind: 'ok', asset: { state: 'PROCESSING' } });
    await service.complete(user.id, a.asset.id);
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ asset_id: a.asset.id });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: a.asset.id } });
    expect(row.mime).toBe('image/jpeg');
    expect(row.uploadedAt).not.toBeNull();
  });

  it('concurrent completes write one outbox event', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    await put(a.asset.id, JPEG);
    await Promise.all([1, 2, 3].map(() => service.complete(user.id, a.asset.id)));
    expect(await outboxRows()).toHaveLength(1);
  });

  it("answers not_found for another creator's asset and for an unknown id", async () => {
    const a = await makeCreator();
    const b = await makeCreator();
    const asset = await initOk(a.user.id);
    await put(asset.asset.id, JPEG);
    expect(await service.complete(b.user.id, asset.asset.id)).toEqual({ kind: 'not_found' });
    expect(await service.complete(a.user.id, randomUUID())).toEqual({ kind: 'not_found' });
    expect(await service.get(b.user.id, asset.asset.id)).toEqual({ kind: 'not_found' });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.asset.id } });
    expect(row.state).toBe('PENDING');
  });
});

async function processed(creatorUserId: string) {
  const a = await initOk(creatorUserId);
  await put(a.asset.id, JPEG);
  await service.complete(creatorUserId, a.asset.id);
  const thumb = `m/${(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: a.asset.id } })).creatorId}/${a.asset.id}/thumb.webp`;
  return {
    id: a.asset.id,
    meta: {
      mime: 'image/jpeg',
      sizeBytes: 900,
      width: 10,
      height: 10,
      durationMs: null,
      thumbKey: thumb,
    },
  };
}

describe('MediaUploadService.markProcessed', () => {
  it('makes the asset READY with one gallery item, and a second call changes nothing', async () => {
    const { user, creator } = await makeCreator();
    const p = await processed(user.id);
    expect(await service.markProcessed(p.id, p.meta)).toBe('READY');
    expect(await service.markProcessed(p.id, p.meta)).toBe('SKIPPED');
    const items = await prisma.galleryItem.findMany({ where: { creatorId: creator.id } });
    expect(items).toHaveLength(1);
    expect(items[0]?.seq).toBe(1);
    expect(
      (await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } })).lastGallerySeq,
    ).toBe(1);
  });

  it('numbers two assets processed concurrently 1 and 2 without a clash', async () => {
    const { user, creator } = await makeCreator();
    const [a, b] = [await processed(user.id), await processed(user.id)];
    await Promise.all([service.markProcessed(a.id, a.meta), service.markProcessed(b.id, b.meta)]);
    const seqs = (await prisma.galleryItem.findMany({ where: { creatorId: creator.id } }))
      .map((i) => i.seq)
      .sort();
    expect(seqs).toEqual([1, 2]);
  });

  it('skips an asset that is not PROCESSING', async () => {
    const { user } = await makeCreator();
    const a = await initOk(user.id);
    expect(
      await service.markProcessed(a.asset.id, {
        mime: 'image/jpeg',
        sizeBytes: 1,
        width: 1,
        height: 1,
        durationMs: null,
        thumbKey: 'x',
      }),
    ).toBe('SKIPPED');
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('markFailed saves FAILED and deletes the objects, and never touches a READY asset', async () => {
    const { user } = await makeCreator();
    const p = await processed(user.id);
    const key = (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: p.id } })).objectKey;
    await service.markFailed(p.id, 'UNREADABLE');
    expect(await storage.head(key)).toBeNull();
    expect(await service.get(user.id, p.id)).toMatchObject({
      asset: { state: 'FAILED', failure: 'UNREADABLE' },
    });
    expect(await prisma.galleryItem.count()).toBe(0);

    const q = await processed(user.id);
    await service.markProcessed(q.id, q.meta);
    await service.markFailed(q.id, 'UNREADABLE');
    expect((await service.get(user.id, q.id)) as { asset: { state: string } }).toMatchObject({
      asset: { state: 'READY' },
    });
  });
});

describe('MediaUploadService.cleanup', () => {
  it('removes old PENDING and FAILED rows with their objects, never READY or recent ones', async () => {
    const { user } = await makeCreator();
    const oldPending = await initOk(user.id);
    const oldKey = await put(oldPending.asset.id, JPEG);
    const failed = await initOk(user.id);
    await put(failed.asset.id, Buffer.alloc(1000, 0x41));
    await service.complete(user.id, failed.asset.id); // FAILED
    const recent = await initOk(user.id);
    const ready = await processed(user.id);
    await service.markProcessed(ready.id, ready.meta);
    await prisma.mediaAsset.update({
      where: { id: oldPending.asset.id },
      data: { createdAt: new Date(now.getTime() - CLEANUP_AFTER_MS - 1000) },
    });
    const later = new Date(now.getTime() + CLEANUP_AFTER_MS + 60_000);
    // The FAILED row ages with the clock; READY and the recent PENDING must survive a check "now".
    expect(await service.cleanup(now)).toBe(1);
    expect(await storage.head(oldKey)).toBeNull();
    expect(await service.cleanup(later)).toBe(2); // the FAILED row and the now-old pending one
    const left = await prisma.mediaAsset.findMany({ select: { id: true, state: true } });
    expect(left.map((r) => r.id).sort()).toEqual([ready.id].sort());
    expect(recent.asset.id).not.toBe(ready.id);
  });
});

describe('MediaUploadService.listGallery', () => {
  async function addReady(userId: string) {
    const p = await processed(userId);
    await service.markProcessed(p.id, p.meta);
    return p.id;
  }

  it('lists READY gallery items of my creator newest first with signed thumbnails and no keys', async () => {
    const mine = await makeCreator();
    const other = await makeCreator();
    const a = await addReady(mine.user.id);
    const b = await addReady(mine.user.id);
    await addReady(other.user.id);
    await initOk(mine.user.id); // PENDING never shows
    const r = await service.listGallery(mine.user.id, { limit: 30 });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.items.map((i) => i.asset.id)).toEqual([b, a]);
    expect(r.total).toBe(2);
    expect(r.nextCursor).toBeNull();
    expect(r.items[0]?.asset.thumbnailUrl).toContain('/v1/dev-storage/');
    expect(JSON.stringify(r)).not.toMatch(/"m\/|objectKey|thumbKey/);
  });

  it('pages by cursor and stays stable when an item is added meanwhile', async () => {
    const { user } = await makeCreator();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await addReady(user.id));
    const first = await service.listGallery(user.id, { limit: 2 });
    if (first.kind !== 'ok') throw new Error(first.kind);
    expect(first.items.map((i) => i.asset.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).not.toBeNull();
    await addReady(user.id); // a new item arrives between pages
    const second = await service.listGallery(user.id, {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    if (second.kind !== 'ok') throw new Error(second.kind);
    expect(second.items.map((i) => i.asset.id)).toEqual([ids[2], ids[1]]);
    const third = await service.listGallery(user.id, {
      limit: 2,
      cursor: second.nextCursor as string,
    });
    if (third.kind !== 'ok') throw new Error(third.kind);
    expect(third.items.map((i) => i.asset.id)).toEqual([ids[0]]);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor and a user who is not a creator', async () => {
    const { user } = await makeCreator();
    expect(await service.listGallery(user.id, { limit: 5, cursor: '!!!' })).toEqual({
      kind: 'invalid_cursor',
    });
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
    expect(await service.listGallery(customer.id, { limit: 5 })).toEqual({ kind: 'not_creator' });
  });
});

describe('MediaUploadService.galleryItemForOwner', () => {
  async function addReady(userId: string) {
    const p = await processed(userId);
    await service.markProcessed(p.id, p.meta);
    return p.id;
  }
  const detail = async (userId: string, id: string) => {
    const r = await service.galleryItemForOwner(userId, id);
    if (r.kind !== 'ok') throw new Error(r.kind);
    return r;
  };

  it('gives position, total and neighbours for the first, middle and last of three items', async () => {
    const { user } = await makeCreator();
    const oldest = await addReady(user.id);
    const middle = await addReady(user.id);
    const newest = await addReady(user.id);
    const a = await detail(user.id, newest);
    expect([a.position, a.total, a.previousId, a.nextId]).toEqual([1, 3, null, middle]);
    const b = await detail(user.id, middle);
    expect([b.position, b.total, b.previousId, b.nextId]).toEqual([2, 3, newest, oldest]);
    const c = await detail(user.id, oldest);
    expect([c.position, c.total, c.previousId, c.nextId]).toEqual([3, 3, middle, null]);
  });

  it('returns a 5-minute original link with the verified content type', async () => {
    const { user } = await makeCreator();
    const id = await addReady(user.id);
    const r = await detail(user.id, id);
    expect(r.original.url).toContain('/v1/dev-storage/');
    expect(r.original.url).toContain('t=image%2Fjpeg');
    expect(r.original.expiresAt.getTime()).toBe(now.getTime() + 5 * 60_000);
    expect(r.asset.state).toBe('READY');
  });

  it("is not_found for another creator's asset, a PROCESSING asset, an unknown id and a READY asset outside the gallery", async () => {
    const mine = await makeCreator();
    const other = await makeCreator();
    const theirs = await addReady(other.user.id);
    const p = await processed(mine.user.id); // PROCESSING
    const initial = await initOk(mine.user.id);
    const outsideId = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: outsideId,
        creatorId: mine.creator.id,
        clientUploadId: randomUUID(),
        purpose: 'GALLERY',
        kind: 'PHOTO',
        state: 'READY',
        objectKey: `m/${mine.creator.id}/${outsideId}`,
        declaredType: 'image/jpeg',
        declaredBytes: 10n,
        mime: 'image/jpeg',
        sizeBytes: 10n,
        thumbKey: `m/${mine.creator.id}/${outsideId}/thumb.webp`,
      },
    });
    for (const id of [theirs, p.id, initial.asset.id, outsideId, randomUUID()]) {
      expect(await service.galleryItemForOwner(mine.user.id, id)).toEqual({ kind: 'not_found' });
    }
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
    expect(await service.galleryItemForOwner(customer.id, theirs)).toEqual({ kind: 'not_found' });
  });
});

describe('chat uploads (purpose CHAT)', () => {
  async function chatSetup(over: { expired?: boolean } = {}) {
    const { user, creator } = await makeCreator();
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'Rani' } });
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: new Date(now.getTime() - 10 * 86_400_000),
        endsAt: new Date(now.getTime() + (over.expired ? -86_400_000 : 10 * 86_400_000)),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, creatorId: creator.id },
    });
    return { user, creator, customer, conversation };
  }
  const chatInit = (userId: string, conversationId: string | undefined) =>
    service.init(userId, initBody({ purpose: 'CHAT', conversationId }));

  it('binds the asset to the conversation and never gives it a gallery item', async () => {
    const c = await chatSetup();
    const r = await chatInit(c.user.id, c.conversation.id);
    if (r.kind !== 'created') throw new Error(r.kind);
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: r.asset.id } });
    expect(row).toMatchObject({ purpose: 'CHAT', conversationId: c.conversation.id });
    await put(r.asset.id, JPEG);
    await service.complete(c.user.id, r.asset.id);
    const meta = {
      mime: 'image/jpeg',
      sizeBytes: 900,
      width: 8,
      height: 8,
      durationMs: null,
      thumbKey: `${row.objectKey}/thumb.webp`,
    };
    expect(await service.markProcessed(r.asset.id, meta)).toBe('READY');
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(
      (await prisma.creator.findUniqueOrThrow({ where: { id: c.creator.id } })).lastGallerySeq,
    ).toBe(0);
    // ...and it does not show in the gallery listing either.
    const list = await service.listGallery(c.user.id, { limit: 30 });
    if (list.kind !== 'ok') throw new Error(list.kind);
    expect(list.items).toEqual([]);
  });

  it("refuses a conversation that is not the creator's, an unknown or missing one, and an ended chat", async () => {
    const mine = await chatSetup();
    const other = await chatSetup();
    expect(await chatInit(mine.user.id, other.conversation.id)).toEqual({
      kind: 'conversation_not_found',
    });
    expect(await chatInit(mine.user.id, randomUUID())).toEqual({ kind: 'conversation_not_found' });
    expect(await chatInit(mine.user.id, undefined)).toEqual({ kind: 'conversation_not_found' });
    expect(await chatInit(mine.user.id, 'not-a-uuid')).toEqual({ kind: 'conversation_not_found' });
    const ended = await chatSetup({ expired: true });
    expect(await chatInit(ended.user.id, ended.conversation.id)).toEqual({
      kind: 'chat_access_expired',
    });
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it('cleanup removes an unsent chat upload after a day, but never a recent or an attached one', async () => {
    const c = await chatSetup();
    const make = async () => {
      const r = await chatInit(c.user.id, c.conversation.id);
      if (r.kind !== 'created') throw new Error(r.kind);
      const key = await put(r.asset.id, JPEG);
      await service.complete(c.user.id, r.asset.id);
      await service.markProcessed(r.asset.id, {
        mime: 'image/jpeg',
        sizeBytes: 900,
        width: 8,
        height: 8,
        durationMs: null,
        thumbKey: `${key}/thumb.webp`,
      });
      return { id: r.asset.id, key };
    };
    const unsent = await make();
    const attached = await make();
    const recent = await make();
    const message = await prisma.message.create({
      data: {
        conversationId: c.conversation.id,
        senderUserId: c.user.id,
        type: 'MEDIA',
        body: null,
        clientMessageId: randomUUID(),
        seq: 1,
      },
    });
    await prisma.messageAttachment.create({
      data: { messageId: message.id, assetId: attached.id },
    });
    const old = new Date(now.getTime() - CLEANUP_AFTER_MS - 1000);
    await prisma.mediaAsset.updateMany({
      where: { id: { in: [unsent.id, attached.id] } },
      data: { readyAt: old },
    });
    expect(await service.cleanup(now)).toBe(1);
    expect(await storage.head(unsent.key)).toBeNull();
    const left = await prisma.mediaAsset.findMany({ select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([attached.id, recent.id].sort());
    expect(await storage.head(attached.key)).not.toBeNull();
  });
});
