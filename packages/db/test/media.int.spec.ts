import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 95_000n;
let creatorId = '';

const asset = (over: Record<string, unknown> = {}) => {
  const id = randomUUID();
  return prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: 'GALLERY',
      kind: 'PHOTO',
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 1000n,
      ...over,
    },
  });
};
const ready = {
  state: 'READY' as const,
  mime: 'image/jpeg',
  sizeBytes: 900n,
  thumbKey: undefined as string | undefined,
};

beforeEach(async () => {
  await resetDatabase(prisma);
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  creatorId = (await prisma.creator.create({ data: { userId: owner.id, publicCode: 'abcdefgh' } }))
    .id;
});
afterAll(() => prisma.$disconnect());

describe('media_assets', () => {
  it('starts PENDING and the creator counter starts at 0', async () => {
    const a = await asset();
    expect(a.state).toBe('PENDING');
    expect(
      (await prisma.creator.findUniqueOrThrow({ where: { id: creatorId } })).lastGallerySeq,
    ).toBe(0);
  });

  it('rejects a second asset with the same (creator, client_upload_id)', async () => {
    const first = await asset();
    await expect(asset({ clientUploadId: first.clientUploadId })).rejects.toThrow();
  });

  it('rejects a zero declared size', async () => {
    await expect(asset({ declaredBytes: 0n })).rejects.toThrow();
  });

  it('rejects READY without a thumbnail key, and accepts it with one', async () => {
    await expect(asset({ ...ready })).rejects.toThrow();
    const id = randomUUID();
    await asset({
      ...ready,
      id,
      objectKey: `m/${creatorId}/${id}`,
      thumbKey: `m/${creatorId}/${id}/thumb.webp`,
    });
  });

  it('rejects a READY video without a duration', async () => {
    const id = randomUUID();
    const base = {
      ...ready,
      kind: 'VIDEO' as const,
      id,
      objectKey: `m/${creatorId}/${id}`,
      thumbKey: `m/${creatorId}/${id}/thumb.webp`,
    };
    await expect(asset(base)).rejects.toThrow();
    const id2 = randomUUID();
    await asset({
      ...base,
      id: id2,
      objectKey: `m/${creatorId}/${id2}`,
      thumbKey: `m/${creatorId}/${id2}/thumb.webp`,
      durationMs: 2000,
    });
  });

  it('keeps object keys unique', async () => {
    const a = await asset();
    await expect(asset({ objectKey: a.objectKey })).rejects.toThrow();
  });
});

describe('gallery_items', () => {
  it('rejects a duplicate asset and a duplicate seq for one creator', async () => {
    const a = await asset();
    const b = await asset();
    await prisma.galleryItem.create({ data: { creatorId, assetId: a.id, seq: 1 } });
    await expect(
      prisma.galleryItem.create({ data: { creatorId, assetId: a.id, seq: 2 } }),
    ).rejects.toThrow();
    await expect(
      prisma.galleryItem.create({ data: { creatorId, assetId: b.id, seq: 1 } }),
    ).rejects.toThrow();
  });

  it('refuses to delete an asset that a gallery item references', async () => {
    const a = await asset();
    await prisma.galleryItem.create({ data: { creatorId, assetId: a.id, seq: 1 } });
    await expect(prisma.mediaAsset.delete({ where: { id: a.id } })).rejects.toThrow();
  });
});
