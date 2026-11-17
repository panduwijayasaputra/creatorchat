import {
  ADMIN_GALLERY_SORT_FIELDS,
  AdminGalleryQuerySchema,
  type AdminGalleryQuery,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminCreatorGalleryService } from './admin-creator-gallery.service.js';
import { MediaAccessService } from './media-access.service.js';
import { LocalDiskStorage } from './storage/local-disk-storage.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
const NOW = new Date('2026-11-18T10:00:00.000Z');
let dir: string;
let service: AdminCreatorGalleryService;
let n = 94_000n;
let codeNo = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-admin-gallery-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
  const storage = new LocalDiskStorage(dir, 's'.repeat(40), 'http://api.test', () => NOW);
  service = new AdminCreatorGalleryService(
    prisma,
    new MediaAccessService(prisma, storage),
    () => NOW,
  );
});

const q = (over: Record<string, string> = {}): AdminGalleryQuery =>
  AdminGalleryQuerySchema.parse(over);

async function makeCreator(name = 'Salsa') {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: name, role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: { userId: user.id, publicCode: `eeeeeee${'abcdefgh'[codeNo++]}` },
  });
}

/** Gallery item `seq`: even seq = photo, odd = video; size and age depend on seq. */
async function item(
  creatorId: string,
  seq: number,
  over: {
    kind?: 'PHOTO' | 'VIDEO';
    ageDays?: number;
    size?: number;
    duration?: number | null;
  } = {},
) {
  const id = randomUUID();
  const kind = over.kind ?? (seq % 2 === 0 ? 'PHOTO' : 'VIDEO');
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: 'GALLERY',
      kind,
      state: 'READY',
      objectKey: `m/${creatorId}/${id}`,
      declaredType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      declaredBytes: 10n,
      mime: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      sizeBytes: BigInt(over.size ?? seq * 1000),
      thumbKey: `m/${creatorId}/${id}/thumb.webp`,
      durationMs: kind === 'VIDEO' ? (over.duration ?? seq * 1000) : null,
    },
  });
  await prisma.galleryItem.create({
    data: {
      creatorId,
      assetId: id,
      seq,
      addedAt: new Date(NOW.getTime() - (over.ageDays ?? 50 - seq) * DAY),
    },
  });
  return id;
}

async function gallery(count = 12) {
  const creator = await makeCreator();
  const ids: string[] = [];
  for (let seq = 1; seq <= count; seq++) ids.push(await item(creator.id, seq));
  return { creator, ids };
}

async function rows(creatorId: string, query: AdminGalleryQuery) {
  const r = await service.list(creatorId, query);
  if (r.kind !== 'ok') throw new Error(r.kind);
  return r.page;
}

describe('AdminCreatorGalleryService.list', () => {
  it('lists newest upload first with numbers, kinds, durations, sizes and signed thumbnails', async () => {
    const { creator } = await gallery();
    const page = await rows(creator.id, q());
    expect(page.total).toBe(12);
    expect(page.items.map((i) => i.number)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(page.items[0]).toMatchObject({
      number: 12,
      kind: 'PHOTO',
      duration_seconds: null,
      size_bytes: 12000,
    });
    expect(page.items[1]).toMatchObject({ number: 11, kind: 'VIDEO', duration_seconds: 11 });
    expect(page.items[0]?.thumbnail_url).toContain('/v1/dev-storage/');
    expect(JSON.stringify(page)).not.toMatch(/object|thumb_key|conversation|message/i);
  });

  it('searches by number with or without #, and finds nothing for other text', async () => {
    const { creator } = await gallery();
    expect((await rows(creator.id, q({ q: '7' }))).items.map((i) => i.number)).toEqual([7]);
    expect((await rows(creator.id, q({ q: '#12' }))).items.map((i) => i.number)).toEqual([12]);
    expect((await rows(creator.id, q({ q: '99' }))).total).toBe(0);
    expect((await rows(creator.id, q({ q: 'abc' }))).total).toBe(0);
    expect((await rows(creator.id, q({ q: "1' OR '1'='1" }))).total).toBe(0);
  });

  it('filters by kind and by upload period', async () => {
    const { creator } = await gallery();
    const photos = await rows(creator.id, q({ kind: 'PHOTO', page_size: '50' }));
    expect(photos.items.every((i) => i.kind === 'PHOTO')).toBe(true);
    expect(photos.total).toBe(6);
    // seq 12 is 38 days old, seq 1 is 49 days old: nothing within 7 days, seq 12..? within 90
    expect((await rows(creator.id, q({ uploaded: '7' }))).total).toBe(0);
    expect((await rows(creator.id, q({ uploaded: '90' }))).total).toBe(12);
    const recent = await makeCreator('Kirana');
    await item(recent.id, 1, { ageDays: 2 });
    await item(recent.id, 2, { ageDays: 20 });
    await item(recent.id, 3, { ageDays: 60 });
    expect((await rows(recent.id, q({ uploaded: '7' }))).items.map((i) => i.number)).toEqual([1]);
    expect((await rows(recent.id, q({ uploaded: '30' }))).total).toBe(2);
    expect((await rows(recent.id, q({ uploaded: '90' }))).total).toBe(3);
  });

  it.each(ADMIN_GALLERY_SORT_FIELDS.flatMap((s) => [[s, 'asc'] as const, [s, 'desc'] as const]))(
    'sorts by %s %s with a stable tiebreak',
    async (sort, dir) => {
      const creator = await makeCreator();
      // Equal sizes / durations / kinds to force ties.
      for (let seq = 1; seq <= 6; seq++) {
        await item(creator.id, seq, { kind: 'PHOTO', size: seq <= 3 ? 500 : 900, ageDays: 10 });
      }
      const page = await rows(creator.id, q({ sort, dir, page_size: '50' }));
      const nums = page.items.map((i) => i.number);
      expect([...nums].sort()).toEqual([1, 2, 3, 4, 5, 6]);
      if (sort === 'number')
        expect(nums).toEqual(dir === 'asc' ? [1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1]);
      if (sort === 'size') {
        expect(nums).toEqual(dir === 'asc' ? [3, 2, 1, 6, 5, 4] : [6, 5, 4, 3, 2, 1]);
      }
      // Ties always fall back to the newest number first, so two calls agree.
      expect(
        (await rows(creator.id, q({ sort, dir, page_size: '50' }))).items.map((i) => i.number),
      ).toEqual(nums);
    },
  );

  it('pages with real totals and ranges', async () => {
    const { creator } = await gallery(25);
    const first = await rows(creator.id, q({ page_size: '10' }));
    const third = await rows(creator.id, q({ page_size: '10', page: '3' }));
    expect(first.total).toBe(25);
    expect(first.items).toHaveLength(10);
    expect(third.items).toHaveLength(5);
    expect(third.items.map((i) => i.number)).toEqual([5, 4, 3, 2, 1]);
    expect((await rows(creator.id, q({ page: '9' }))).items).toEqual([]);
  });

  it("never lists chat-only READY assets, PROCESSING or FAILED assets, or another creator's items", async () => {
    const { creator } = await gallery(3);
    const other = await makeCreator('Kirana');
    await item(other.id, 1);
    for (const state of ['READY', 'PROCESSING', 'FAILED'] as const) {
      const id = randomUUID();
      await prisma.mediaAsset.create({
        data: {
          id,
          creatorId: creator.id,
          clientUploadId: randomUUID(),
          purpose: 'GALLERY',
          kind: 'PHOTO',
          state,
          objectKey: `m/${creator.id}/${id}`,
          declaredType: 'image/jpeg',
          declaredBytes: 10n,
          ...(state === 'READY'
            ? { mime: 'image/jpeg', sizeBytes: 10n, thumbKey: `m/${creator.id}/${id}/thumb.webp` }
            : {}),
        },
      });
    }
    const page = await rows(creator.id, q());
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.number).sort()).toEqual([1, 2, 3]);
  });

  it('an unknown or malformed creator id is creator_not_found; a blocked creator is still viewable', async () => {
    const { creator } = await gallery(2);
    await prisma.creator.update({ where: { id: creator.id }, data: { status: 'BLOCKED' } });
    expect((await rows(creator.id, q())).total).toBe(2);
    expect(await service.list(randomUUID(), q())).toEqual({ kind: 'creator_not_found' });
    expect(await service.list('not-a-uuid', q())).toEqual({ kind: 'creator_not_found' });
  });
});

describe('AdminCreatorGalleryService.detail', () => {
  it('gives the item with number, short id, creator, a 5-minute preview and a video poster', async () => {
    const { creator, ids } = await gallery(3);
    const video = await service.detail(creator.id, ids[2] as string); // seq 3 = video
    if (video.kind !== 'ok') throw new Error(video.kind);
    expect(video.detail).toMatchObject({
      number: 3,
      kind: 'VIDEO',
      duration_seconds: 3,
      size_bytes: 3000,
      shown_in: 'GALLERY',
      creator: { id: creator.id, display_name: 'Salsa' },
    });
    expect(video.detail.short_id).toMatch(/^med_[0-9a-f]{7}$/);
    expect(new Date(video.detail.preview.expires_at).getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(video.detail.poster_url).toContain('/v1/dev-storage/');
    const photo = await service.detail(creator.id, ids[1] as string);
    if (photo.kind !== 'ok') throw new Error(photo.kind);
    expect(photo.detail.poster_url).toBeNull();
  });

  it("is media_not_found for another creator's asset, a chat-only READY asset, PROCESSING and malformed ids", async () => {
    const { creator } = await gallery(1);
    const other = await makeCreator('Kirana');
    const theirs = await item(other.id, 1);
    const chatOnly = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: chatOnly,
        creatorId: creator.id,
        clientUploadId: randomUUID(),
        purpose: 'GALLERY',
        kind: 'PHOTO',
        state: 'READY',
        objectKey: `m/${creator.id}/${chatOnly}`,
        declaredType: 'image/jpeg',
        declaredBytes: 10n,
        mime: 'image/jpeg',
        sizeBytes: 10n,
        thumbKey: `m/${creator.id}/${chatOnly}/thumb.webp`,
      },
    });
    for (const id of [theirs, chatOnly, randomUUID(), 'not-a-uuid']) {
      expect(await service.detail(creator.id, id)).toEqual({ kind: 'media_not_found' });
    }
    expect(await service.detail(randomUUID(), theirs)).toEqual({ kind: 'creator_not_found' });
  });
});
