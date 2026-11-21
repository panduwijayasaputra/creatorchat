import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 96_000n;
const ids = { creator: '', asset: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'abcdefgh' },
  });
  const assetId = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      creatorId: creator.id,
      clientUploadId: randomUUID(),
      purpose: 'WELCOME',
      kind: 'PHOTO',
      objectKey: `m/${creator.id}/${assetId}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
    },
  });
  ids.creator = creator.id;
  ids.asset = assetId;
});
afterAll(() => prisma.$disconnect());

const welcome = (over: Record<string, unknown> = {}) =>
  prisma.creatorWelcomeMessage.create({ data: { creatorId: ids.creator, ...over } });

describe('creator welcome messages', () => {
  it('start switched off, without text or media, one row per creator', async () => {
    const row = await welcome();
    expect(row).toMatchObject({ enabled: false, body: null, assetId: null });
    await expect(welcome()).rejects.toThrow();
  });

  it('need text while switched on; a draft text may be kept while switched off', async () => {
    await expect(welcome({ enabled: true })).rejects.toThrow();
    await expect(welcome({ enabled: true, body: null })).rejects.toThrow();
    await prisma.creatorWelcomeMessage.deleteMany();
    expect(await welcome({ enabled: false, body: 'Halo, selamat datang!' })).toMatchObject({
      enabled: false,
    });
    await prisma.creatorWelcomeMessage.deleteMany();
    expect(await welcome({ enabled: true, body: 'Halo!' })).toMatchObject({ enabled: true });
  });

  it('the text is 1 to 2000 characters', async () => {
    await expect(welcome({ body: '' })).rejects.toThrow();
    await prisma.creatorWelcomeMessage.deleteMany();
    await expect(welcome({ body: 'a'.repeat(2001) })).rejects.toThrow();
    await prisma.creatorWelcomeMessage.deleteMany();
    await welcome({ body: 'a'.repeat(2000) });
  });

  it('keeps its media: the asset cannot be deleted while the welcome message uses it', async () => {
    await welcome({ body: 'Halo', assetId: ids.asset });
    await expect(prisma.mediaAsset.delete({ where: { id: ids.asset } })).rejects.toThrow();
  });

  it('needs an existing creator and an existing asset', async () => {
    await expect(
      prisma.creatorWelcomeMessage.create({
        data: { creatorId: '00000000-0000-4000-8000-000000000000' },
      }),
    ).rejects.toThrow();
    await expect(
      welcome({ body: 'Halo', assetId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow();
  });
});
