import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { FixedWindowLimiter, type RateLimiterRedis } from '../user-auth/rate-limiter.js';
import {
  BROADCAST_RATE_LIMIT,
  BroadcastService,
  type CreateBroadcastInput,
} from './broadcast.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const now = new Date('2026-11-21T05:00:00.000Z');
const service = new BroadcastService(prisma, new OutboxService(), () => now);
const DAY = 86_400_000;

let n = 64_000n;
let codeNo = 0;
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

async function makeCreator(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: `bbbbbbb${'abcdefgh'[codeNo++]}`, status },
  });
  return { user, creator };
}

async function subscribe(creatorId: string, over: { endsInDays?: number; revoked?: boolean } = {}) {
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'Raka' } });
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId,
      startsAt: new Date(now.getTime() - 30 * DAY),
      endsAt: new Date(now.getTime() + (over.endsInDays ?? 10) * DAY),
      revokedAt: over.revoked ? new Date(now.getTime() - 1000) : null,
    },
  });
  return customer;
}

async function makeAsset(
  creatorId: string,
  over: {
    purpose?: 'GALLERY' | 'CHAT' | 'BROADCAST' | 'WELCOME';
    state?: 'READY' | 'PENDING' | 'FAILED';
    gallery?: boolean;
  } = {},
) {
  const id = randomUUID();
  const state = over.state ?? 'READY';
  const asset = await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: over.purpose ?? 'BROADCAST',
      kind: 'PHOTO',
      state,
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      ...(state === 'READY'
        ? {
            mime: 'image/jpeg',
            sizeBytes: 9n,
            thumbKey: `m/${creatorId}/${id}/thumb.webp`,
            readyAt: now,
          }
        : {}),
      ...(over.purpose === 'CHAT' ? {} : {}),
    },
  });
  if (over.gallery) {
    await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: 1 } });
    await prisma.creator.update({ where: { id: creatorId }, data: { lastGallerySeq: 1 } });
  }
  return asset;
}

const input = (
  assetId: string,
  over: Partial<CreateBroadcastInput> = {},
): CreateBroadcastInput => ({
  clientBroadcastId: randomUUID(),
  assetId,
  saveToGallery: false,
  ...over,
});

const outbox = () => prisma.outboxEvent.findMany({ where: { type: 'broadcast.created' } });
const counts = async () => ({
  broadcasts: await prisma.broadcast.count(),
  gallery: await prisma.galleryItem.count(),
  outbox: (await outbox()).length,
});

describe('BroadcastService.create', () => {
  it('records a broadcast of a gallery file without a new gallery item or object, and writes one event', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const asset = await makeAsset(creator.id, { purpose: 'GALLERY', gallery: true });
    const r = await service.create(user.id, input(asset.id, { body: 'Promo hari ini' }));
    expect(r.kind).toBe('created');
    expect(await prisma.broadcast.findFirstOrThrow()).toMatchObject({
      creatorId: creator.id,
      assetId: asset.id,
      body: 'Promo hari ini',
      saveToGallery: false,
      status: 'QUEUED',
    });
    expect(await prisma.galleryItem.count()).toBe(1);
    expect(await prisma.mediaAsset.count()).toBe(1);
    const [event] = await outbox();
    expect(event?.payload).toEqual({
      broadcast_id: r.kind === 'created' ? r.broadcast.id : '',
      creator_id: creator.id,
    });
    expect(event?.status).toBe('PENDING');
  });

  it('the same gallery file can be broadcast again', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const asset = await makeAsset(creator.id, { purpose: 'GALLERY', gallery: true });
    expect((await service.create(user.id, input(asset.id))).kind).toBe('created');
    expect((await service.create(user.id, input(asset.id))).kind).toBe('created');
    expect(await prisma.broadcast.count()).toBe(2);
  });

  it('an upload with the box unticked stays out of the gallery; ticked, it gets exactly one item', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const plain = await makeAsset(creator.id);
    expect((await service.create(user.id, input(plain.id))).kind).toBe('created');
    expect(await prisma.galleryItem.count({ where: { assetId: plain.id } })).toBe(0);

    const saved = await makeAsset(creator.id);
    const r = await service.create(user.id, input(saved.id, { saveToGallery: true }));
    expect(r.kind).toBe('created');
    const items = await prisma.galleryItem.findMany({ where: { assetId: saved.id } });
    expect(items).toHaveLength(1);
    expect(items[0]?.seq).toBe(1);
    expect(
      (await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } })).lastGallerySeq,
    ).toBe(1);
    expect(await prisma.mediaAsset.count()).toBe(2);
  });

  it('an upload belongs to one broadcast', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const asset = await makeAsset(creator.id);
    expect((await service.create(user.id, input(asset.id))).kind).toBe('created');
    expect((await service.create(user.id, input(asset.id))).kind).toBe('media_not_found');
    expect(await prisma.broadcast.count()).toBe(1);
  });

  it('the box is refused with a gallery file, and nothing is written', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const asset = await makeAsset(creator.id, { purpose: 'GALLERY', gallery: true });
    expect((await service.create(user.id, input(asset.id, { saveToGallery: true }))).kind).toBe(
      'invalid',
    );
    expect(await counts()).toEqual({ broadcasts: 0, gallery: 1, outbox: 0 });
  });

  it("another creator's file, a chat or welcome file, an unknown or malformed id all look the same", async () => {
    const { user, creator } = await makeCreator();
    const other = await makeCreator();
    await subscribe(creator.id);
    const foreign = await makeAsset(other.creator.id);
    const chat = await makeAsset(creator.id, { purpose: 'CHAT' }).catch(() => null);
    const welcome = await makeAsset(creator.id, { purpose: 'WELCOME' });
    const ungalleried = await makeAsset(creator.id, { purpose: 'GALLERY' });
    const ids = [foreign.id, welcome.id, ungalleried.id, randomUUID(), 'not-a-uuid'];
    if (chat) ids.push(chat.id);
    for (const id of ids) {
      expect((await service.create(user.id, input(id))).kind, id).toBe('media_not_found');
    }
    expect(await counts()).toEqual({ broadcasts: 0, gallery: 0, outbox: 0 });
  });

  it('a file that is still processing is not ready; a failed one is not found', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const pending = await makeAsset(creator.id, { state: 'PENDING' });
    const failed = await makeAsset(creator.id, { state: 'FAILED' });
    expect((await service.create(user.id, input(pending.id))).kind).toBe('media_not_ready');
    expect((await service.create(user.id, input(failed.id))).kind).toBe('media_not_found');
  });

  it('refuses when nobody has active access (only expired, revoked or not yet started)', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id, { endsInDays: -1 });
    await subscribe(creator.id, { revoked: true });
    const blockedCustomer = await subscribe(creator.id);
    await prisma.user.update({ where: { id: blockedCustomer.id }, data: { status: 'BLOCKED' } });
    const asset = await makeAsset(creator.id);
    expect((await service.create(user.id, input(asset.id))).kind).toBe('no_active_subscribers');
    expect(await counts()).toEqual({ broadcasts: 0, gallery: 0, outbox: 0 });
    // The refused upload is still usable afterwards.
    await subscribe(creator.id);
    expect((await service.create(user.id, input(asset.id))).kind).toBe('created');
  });

  it('a retry returns the stored broadcast, also after the subscribers are gone; changed content conflicts', async () => {
    const { user, creator } = await makeCreator();
    const customer = await subscribe(creator.id);
    const asset = await makeAsset(creator.id);
    const first = input(asset.id, { body: 'Halo' });
    const a = await service.create(user.id, first);
    await prisma.subscription.deleteMany({ where: { customerId: customer.id } });
    const b = await service.create(user.id, first);
    expect(a.kind).toBe('created');
    expect(b.kind).toBe('replayed');
    expect(a.kind === 'created' && b.kind === 'replayed' && a.broadcast.id === b.broadcast.id).toBe(
      true,
    );
    expect(await counts()).toEqual({ broadcasts: 1, gallery: 0, outbox: 1 });
    expect((await service.create(user.id, { ...first, body: 'Beda' })).kind).toBe('conflict');
    expect((await service.create(user.id, { ...first, saveToGallery: true })).kind).toBe(
      'conflict',
    );
  });

  it('two identical requests at once make one broadcast and one event', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const asset = await makeAsset(creator.id);
    const same = input(asset.id);
    const results = await Promise.all([
      service.create(user.id, same),
      service.create(user.id, same),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'replayed']);
    expect(await counts()).toEqual({ broadcasts: 1, gallery: 0, outbox: 1 });
  });

  it('a blocked creator, a blocked creator account, a customer account and an unknown user get nothing', async () => {
    const blocked = await makeCreator('BLOCKED');
    await subscribe(blocked.creator.id);
    const a1 = await makeAsset(blocked.creator.id);
    expect((await service.create(blocked.user.id, input(a1.id))).kind).toBe('not_found');

    const acct = await makeCreator();
    await subscribe(acct.creator.id);
    const a2 = await makeAsset(acct.creator.id);
    await prisma.user.update({ where: { id: acct.user.id }, data: { status: 'BLOCKED' } });
    expect((await service.create(acct.user.id, input(a2.id))).kind).toBe('not_found');

    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
    expect((await service.create(customer.id, input(a2.id))).kind).toBe('not_found');
    expect((await service.create(randomUUID(), input(a2.id))).kind).toBe('not_found');
    expect(await counts()).toEqual({ broadcasts: 0, gallery: 0, outbox: 0 });
  });

  it('refuses a blank or over-long text and a malformed client id', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    const asset = await makeAsset(creator.id);
    expect((await service.create(user.id, input(asset.id, { body: '' }))).kind).toBe('invalid');
    expect((await service.create(user.id, input(asset.id, { body: 'a'.repeat(2001) }))).kind).toBe(
      'invalid',
    );
    expect((await service.create(user.id, input(asset.id, { clientBroadcastId: 'x' }))).kind).toBe(
      'invalid',
    );
    expect((await service.create(user.id, input(asset.id, { body: 'a'.repeat(2000) }))).kind).toBe(
      'created',
    );
  });
});

describe('rate limit', () => {
  /** Counters in memory: the limiter only needs four Redis commands. */
  function fakeRedis(): RateLimiterRedis {
    const values = new Map<string, number>();
    return {
      get: async (k) => (values.has(k) ? String(values.get(k)) : null),
      incr: async (k) => {
        values.set(k, (values.get(k) ?? 0) + 1);
        return values.get(k) as number;
      },
      ttl: async () => 42,
      set: async (k, v, _m, _s, flag) => {
        if (flag === 'NX' && values.has(k)) return null;
        values.set(k, Number(v));
        return 'OK';
      },
    };
  }

  it('answers rate_limited after the allowed sends, writing nothing for the refused one', async () => {
    const limited = new BroadcastService(
      prisma,
      new OutboxService(),
      () => now,
      new FixedWindowLimiter(fakeRedis(), 'test:broadcast'),
    );
    const { user, creator } = await makeCreator();
    await subscribe(creator.id);
    for (let i = 0; i < BROADCAST_RATE_LIMIT.limit; i++) {
      const asset = await makeAsset(creator.id);
      expect((await limited.create(user.id, input(asset.id))).kind).toBe('created');
    }
    const extra = await makeAsset(creator.id);
    expect(await limited.create(user.id, input(extra.id))).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 42,
    });
    expect(await prisma.broadcast.count()).toBe(BROADCAST_RATE_LIMIT.limit);
  });
});
