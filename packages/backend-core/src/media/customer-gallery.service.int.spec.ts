import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CustomerGalleryService } from './customer-gallery.service.js';
import { MediaAccessService } from './media-access.service.js';
import { LocalDiskStorage } from './storage/local-disk-storage.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
let dir: string;
let service: CustomerGalleryService;
let now = new Date('2026-11-18T10:00:00.000Z');
let n = 96_000n;
let codeNo = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-customer-gallery-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
beforeEach(async () => {
  now = new Date('2026-11-18T10:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
  const storage = new LocalDiskStorage(dir, 's'.repeat(40), 'http://api.test', () => now);
  service = new CustomerGalleryService(prisma, new MediaAccessService(prisma, storage), () => now);
});

const ms = (d: number) => new Date(now.getTime() + d);

async function makeCreator(
  over: { status?: 'ACTIVE' | 'BLOCKED'; userStatus?: 'ACTIVE' | 'BLOCKED' } = {},
) {
  const user = await prisma.user.create({
    data: {
      telegramId: n++,
      displayName: 'Salsa',
      role: 'CREATOR',
      status: over.userStatus ?? 'ACTIVE',
    },
  });
  const code = `ddddddd${'abcdefgh'[codeNo++]}`;
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: code, status: over.status ?? 'ACTIVE' },
  });
  return { user, creator, code };
}

async function makeCustomer() {
  return prisma.user.create({ data: { telegramId: n++, displayName: 'Nadia' } });
}

const subscribe = (
  customerId: string,
  creatorId: string,
  over: { startsAt?: Date; endsAt?: Date; revokedAt?: Date | null } = {},
) =>
  prisma.subscription.create({
    data: {
      customerId,
      creatorId,
      startsAt: over.startsAt ?? ms(-10 * DAY),
      endsAt: over.endsAt ?? ms(10 * DAY),
      revokedAt: over.revokedAt ?? null,
    },
  });

/** A READY asset; `inGallery` adds the gallery item (seq 1, 2, ...). */
async function asset(
  creatorId: string,
  over: { state?: 'READY' | 'PROCESSING'; kind?: 'PHOTO' | 'VIDEO'; seq?: number | null } = {},
) {
  const id = randomUUID();
  const state = over.state ?? 'READY';
  const kind = over.kind ?? 'PHOTO';
  const row = await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: 'GALLERY',
      kind,
      state,
      objectKey: `m/${creatorId}/${id}`,
      declaredType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      declaredBytes: 100n,
      ...(state === 'READY'
        ? {
            mime: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
            sizeBytes: 100n,
            thumbKey: `m/${creatorId}/${id}/thumb.webp`,
            durationMs: kind === 'VIDEO' ? 48_000 : null,
          }
        : {}),
    },
  });
  if (over.seq !== null && over.seq !== undefined) {
    await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: over.seq } });
  }
  return row;
}

async function gallery() {
  const c = await makeCreator();
  const customer = await makeCustomer();
  const a = await asset(c.creator.id, { seq: 1 });
  const b = await asset(c.creator.id, { seq: 2, kind: 'VIDEO' });
  const d = await asset(c.creator.id, { seq: 3 });
  return { ...c, customer, a, b, d };
}

describe('CustomerGalleryService with active access', () => {
  it('lists newest first with a total, signed thumbnails and public fields only', async () => {
    const g = await gallery();
    await subscribe(g.customer.id, g.creator.id);
    const r = await service.list(g.customer.id, g.code, { limit: 30 });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.items.map((i) => i.id)).toEqual([g.d.id, g.b.id, g.a.id]);
    expect(r.total).toBe(3);
    expect(r.items[1]).toMatchObject({ kind: 'VIDEO', durationSeconds: 48 });
    expect(r.items[0]?.thumbnailUrl).toContain('/v1/dev-storage/');
    expect(JSON.stringify(r)).not.toMatch(/objectKey|thumbKey|state|READY/);
  });

  it('pages by cursor', async () => {
    const g = await gallery();
    await subscribe(g.customer.id, g.creator.id);
    const first = await service.list(g.customer.id, g.code, { limit: 2 });
    if (first.kind !== 'ok') throw new Error(first.kind);
    expect(first.items.map((i) => i.id)).toEqual([g.d.id, g.b.id]);
    const second = await service.list(g.customer.id, g.code, {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    if (second.kind !== 'ok') throw new Error(second.kind);
    expect(second.items.map((i) => i.id)).toEqual([g.a.id]);
    expect(await service.list(g.customer.id, g.code, { limit: 2, cursor: '!!!' })).toEqual({
      kind: 'invalid_cursor',
    });
  });

  it('gives an item with position, neighbours, creator name and a 5-minute link', async () => {
    const g = await gallery();
    await subscribe(g.customer.id, g.creator.id);
    const r = await service.item(g.customer.id, g.code, g.b.id);
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect([r.position, r.total, r.previousId, r.nextId]).toEqual([2, 3, g.d.id, g.a.id]);
    expect(r.creatorName).toBe('Salsa');
    expect(r.original.expiresAt.getTime()).toBe(now.getTime() + 5 * 60_000);
    expect(r.original.url).toContain('t=video%2Fmp4');
    expect(r.item.id).toBe(g.b.id);
  });
});

describe('CustomerGalleryService without active access', () => {
  const states: [string, (g: Awaited<ReturnType<typeof gallery>>) => Promise<unknown>][] = [
    ['no relation (guest)', async () => undefined],
    [
      'an expired subscription',
      (g) => subscribe(g.customer.id, g.creator.id, { startsAt: ms(-20 * DAY), endsAt: ms(-DAY) }),
    ],
    [
      'a revoked subscription',
      (g) => subscribe(g.customer.id, g.creator.id, { revokedAt: ms(-DAY) }),
    ],
    [
      'a subscription that starts in the future',
      (g) => subscribe(g.customer.id, g.creator.id, { startsAt: ms(DAY), endsAt: ms(30 * DAY) }),
    ],
    [
      'only a pending access request',
      (g) =>
        prisma.accessRequest.create({
          data: { customerId: g.customer.id, creatorId: g.creator.id, type: 'TRIAL' },
        }),
    ],
    [
      'an active subscription to another creator',
      async (g) => {
        const other = await makeCreator();
        await subscribe(g.customer.id, other.creator.id);
      },
    ],
  ];

  it.each(states)(
    '%s: not_entitled for the list and every item, with no data',
    async (_name, setup) => {
      const g = await gallery();
      await setup(g);
      expect(await service.list(g.customer.id, g.code, { limit: 30 })).toEqual({
        kind: 'not_entitled',
      });
      for (const id of [g.a.id, g.b.id, randomUUID()]) {
        expect(await service.item(g.customer.id, g.code, id)).toEqual({ kind: 'not_entitled' });
      }
    },
  );

  it('a blocked creator, a blocked creator account and a malformed code are creator_not_found', async () => {
    const blocked = await makeCreator({ status: 'BLOCKED' });
    const blockedUser = await makeCreator({ userStatus: 'BLOCKED' });
    const customer = await makeCustomer();
    await subscribe(customer.id, blocked.creator.id);
    await subscribe(customer.id, blockedUser.creator.id);
    for (const code of [blocked.code, blockedUser.code, 'nope', '../x', 'zzzzzzzz']) {
      expect(await service.list(customer.id, code, { limit: 30 })).toEqual({
        kind: 'creator_not_found',
      });
      expect(await service.item(customer.id, code, randomUUID())).toEqual({
        kind: 'creator_not_found',
      });
    }
  });

  it('a blocked customer account is not entitled', async () => {
    const g = await gallery();
    await subscribe(g.customer.id, g.creator.id);
    await prisma.user.update({ where: { id: g.customer.id }, data: { status: 'BLOCKED' } });
    expect(await service.list(g.customer.id, g.code, { limit: 30 })).toEqual({
      kind: 'not_entitled',
    });
  });

  it('access ending between two calls: the second is not_entitled', async () => {
    const g = await gallery();
    const sub = await subscribe(g.customer.id, g.creator.id);
    expect((await service.list(g.customer.id, g.code, { limit: 30 })).kind).toBe('ok');
    await prisma.subscription.update({ where: { id: sub.id }, data: { endsAt: ms(1000) } });
    now = ms(2000);
    expect(await service.list(g.customer.id, g.code, { limit: 30 })).toEqual({
      kind: 'not_entitled',
    });
    expect(await service.item(g.customer.id, g.code, g.a.id)).toEqual({ kind: 'not_entitled' });
  });
});

describe('CustomerGalleryService item lookups', () => {
  it("is media_not_found for another creator's asset, a READY asset outside the gallery and a PROCESSING asset", async () => {
    const g = await gallery();
    await subscribe(g.customer.id, g.creator.id);
    const other = await makeCreator();
    const theirs = await asset(other.creator.id, { seq: 1 });
    const outside = await asset(g.creator.id, { seq: null });
    const processing = await asset(g.creator.id, { state: 'PROCESSING', seq: null });
    for (const id of [theirs.id, outside.id, processing.id, randomUUID(), 'not-a-uuid']) {
      expect(await service.item(g.customer.id, g.code, id)).toEqual({ kind: 'media_not_found' });
    }
    const listed = await service.list(g.customer.id, g.code, { limit: 30 });
    if (listed.kind !== 'ok') throw new Error(listed.kind);
    expect(listed.items.map((i) => i.id)).not.toContain(outside.id);
    expect(listed.total).toBe(3);
  });
});
