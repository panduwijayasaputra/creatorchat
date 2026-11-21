import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '../media/storage/local-disk-storage.js';
import { MediaAccessService } from '../media/media-access.service.js';
import { CreatorSettingsService } from '../creator-settings/creator-settings.service.js';
import { WelcomeMessageService } from './welcome-message.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const storage = new LocalDiskStorage('/tmp/cc-welcome-test', 's'.repeat(40), 'http://api.test');
const service = new WelcomeMessageService(prisma, new MediaAccessService(prisma, storage));

let n = 84_000n;
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
    data: { userId: user.id, publicCode: `wwwwwww${'abcdefgh'[codeNo++]}`, status },
  });
  return { user, creator };
}

async function makeAsset(
  creatorId: string,
  over: {
    purpose?: 'GALLERY' | 'CHAT' | 'BROADCAST' | 'WELCOME';
    state?: 'READY' | 'PENDING' | 'FAILED';
    gallery?: boolean;
    kind?: 'PHOTO' | 'VIDEO';
  } = {},
) {
  const id = randomUUID();
  const state = over.state ?? 'READY';
  const kind = over.kind ?? 'PHOTO';
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: over.purpose ?? 'WELCOME',
      kind,
      state,
      objectKey: `m/${creatorId}/${id}`,
      declaredType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      declaredBytes: 10n,
      ...(state === 'READY'
        ? {
            mime: 'x/y',
            sizeBytes: 9n,
            thumbKey: `m/${creatorId}/${id}/thumb.webp`,
            durationMs: kind === 'VIDEO' ? 48_000 : null,
          }
        : {}),
    },
  });
  if (over.gallery) await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: 1 } });
  return id;
}

const stored = (creatorId: string) =>
  prisma.creatorWelcomeMessage.findUnique({ where: { creatorId } });

describe('get', () => {
  it('is off, empty and without media before anything was saved, and reading writes nothing', async () => {
    const c = await makeCreator();
    expect(await service.get(c.user.id)).toEqual({
      kind: 'ok',
      welcome: { enabled: false, body: '', media: null },
    });
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });

  it('is not_found for a customer, an unknown user, a blocked creator and a blocked account', async () => {
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
    const blocked = await makeCreator('BLOCKED');
    const account = await makeCreator();
    await prisma.user.update({ where: { id: account.user.id }, data: { status: 'BLOCKED' } });
    for (const id of [customer.id, randomUUID(), blocked.user.id, account.user.id]) {
      expect(await service.get(id)).toEqual({ kind: 'not_found' });
    }
  });
});

describe('save', () => {
  it('stores text only, and answers the saved state', async () => {
    const c = await makeCreator();
    const r = await service.save(c.user.id, {
      enabled: true,
      body: '  Halo, selamat datang!  ',
      assetId: null,
    });
    expect(r).toEqual({
      kind: 'saved',
      welcome: { enabled: true, body: 'Halo, selamat datang!', media: null },
    });
    expect(await stored(c.creator.id)).toMatchObject({
      enabled: true,
      body: 'Halo, selamat datang!',
      assetId: null,
    });
  });

  it('takes a gallery file (the same asset, no copy) and shows it as GALLERY with a signed thumbnail', async () => {
    const c = await makeCreator();
    const asset = await makeAsset(c.creator.id, {
      purpose: 'GALLERY',
      gallery: true,
      kind: 'VIDEO',
    });
    const r = await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: asset });
    expect(r.kind).toBe('saved');
    if (r.kind !== 'saved') return;
    expect(r.welcome.media).toMatchObject({
      assetId: asset,
      kind: 'VIDEO',
      source: 'GALLERY',
      durationSeconds: 48,
    });
    expect(r.welcome.media?.thumbnailUrl).toMatch(/^http:\/\/api\.test\//);
    expect(await prisma.mediaAsset.count()).toBe(1);
    expect(await prisma.galleryItem.count()).toBe(1);
  });

  it('takes an upload made for the welcome message as UPLOAD, and it never enters the gallery', async () => {
    const c = await makeCreator();
    const asset = await makeAsset(c.creator.id);
    const r = await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: asset });
    expect(r.kind === 'saved' && r.welcome.media?.source).toBe('UPLOAD');
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('replaces and removes the media, and a save with the same input changes nothing', async () => {
    const c = await makeCreator();
    const first = await makeAsset(c.creator.id);
    const second = await makeAsset(c.creator.id);
    await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: first });
    const again = await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: first });
    expect(again.kind === 'saved' && again.welcome.media?.assetId).toBe(first);
    const replaced = await service.save(c.user.id, {
      enabled: true,
      body: 'Halo',
      assetId: second,
    });
    expect(replaced.kind === 'saved' && replaced.welcome.media?.assetId).toBe(second);
    const removed = await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: null });
    expect(removed.kind === 'saved' && removed.welcome.media).toBeNull();
    expect(await prisma.creatorWelcomeMessage.count()).toBe(1);
    expect((await stored(c.creator.id))?.assetId).toBeNull();
  });

  it('keeps a draft text while switched off, and clears an empty one to nothing', async () => {
    const c = await makeCreator();
    expect(
      await service.save(c.user.id, { enabled: false, body: 'Draft', assetId: null }),
    ).toMatchObject({
      welcome: { enabled: false, body: 'Draft' },
    });
    expect(
      await service.save(c.user.id, { enabled: false, body: '', assetId: null }),
    ).toMatchObject({
      welcome: { enabled: false, body: '' },
    });
    expect((await stored(c.creator.id))?.body).toBeNull();
  });

  it('refuses the switch on without text, and an over-long text, writing nothing', async () => {
    const c = await makeCreator();
    expect(
      (await service.save(c.user.id, { enabled: true, body: '   ', assetId: null })).kind,
    ).toBe('invalid');
    expect(
      (await service.save(c.user.id, { enabled: false, body: 'a'.repeat(2001), assetId: null }))
        .kind,
    ).toBe('invalid');
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });

  it("another creator's file, a chat or broadcast file, an un-galleried gallery file, unknown and malformed ids all look the same", async () => {
    const c = await makeCreator();
    const other = await makeCreator();
    const ids = [
      await makeAsset(other.creator.id),
      await makeAsset(c.creator.id, { purpose: 'BROADCAST' }),
      await makeAsset(c.creator.id, { purpose: 'GALLERY' }),
      randomUUID(),
      'not-a-uuid',
    ];
    for (const assetId of ids) {
      expect(
        (await service.save(c.user.id, { enabled: true, body: 'Halo', assetId })).kind,
        assetId,
      ).toBe('media_not_found');
    }
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });

  it('a file that is still processing is not ready; a failed one is not found', async () => {
    const c = await makeCreator();
    const pending = await makeAsset(c.creator.id, { state: 'PENDING' });
    const failed = await makeAsset(c.creator.id, { state: 'FAILED' });
    expect(
      (await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: pending })).kind,
    ).toBe('media_not_ready');
    expect(
      (await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: failed })).kind,
    ).toBe('media_not_found');
  });

  it('a customer, a blocked creator and a blocked account cannot save', async () => {
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
    const blocked = await makeCreator('BLOCKED');
    for (const id of [customer.id, blocked.user.id, randomUUID()]) {
      expect((await service.save(id, { enabled: true, body: 'Halo', assetId: null })).kind).toBe(
        'not_found',
      );
    }
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });

  it("one creator's message never touches another's", async () => {
    const a = await makeCreator();
    const b = await makeCreator();
    await service.save(a.user.id, { enabled: true, body: 'Dari A', assetId: null });
    await service.save(b.user.id, { enabled: true, body: 'Dari B', assetId: null });
    expect(await service.get(a.user.id)).toMatchObject({ welcome: { body: 'Dari A' } });
    expect(await service.get(b.user.id)).toMatchObject({ welcome: { body: 'Dari B' } });
  });

  it('two saves at once end in one of the two states, in one row', async () => {
    const c = await makeCreator();
    await Promise.all([
      service.save(c.user.id, { enabled: true, body: 'Satu', assetId: null }),
      service.save(c.user.id, { enabled: true, body: 'Dua', assetId: null }),
    ]);
    expect(await prisma.creatorWelcomeMessage.count()).toBe(1);
    expect(['Satu', 'Dua']).toContain((await stored(c.creator.id))?.body);
  });
});

describe('settings and cleanup', () => {
  it('the creator settings show whether the welcome message is switched on', async () => {
    const c = await makeCreator();
    const settings = new CreatorSettingsService(prisma);
    expect((await settings.get(c.user.id))?.welcomeEnabled).toBe(false);
    await service.save(c.user.id, { enabled: false, body: 'Draft', assetId: null });
    expect((await settings.get(c.user.id))?.welcomeEnabled).toBe(false);
    await service.save(c.user.id, { enabled: true, body: 'Halo', assetId: null });
    expect((await settings.get(c.user.id))?.welcomeEnabled).toBe(true);
  });
});
