import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatMediaService } from './chat-media.service.js';
import { MediaAccessService } from './media-access.service.js';
import { LocalDiskStorage } from './storage/local-disk-storage.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
let dir: string;
let service: ChatMediaService;
let now = new Date('2026-11-18T10:00:00.000Z');
let n = 91_000n;
let codeNo = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-chat-media-svc-'));
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
  service = new ChatMediaService(prisma, new MediaAccessService(prisma, storage), () => now);
});

async function setup(over: { subscription?: 'active' | 'expired' | 'revoked' } = {}) {
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'Rani' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `ggggggg${'abcdefgh'[codeNo++]}` },
  });
  const kind = over.subscription ?? 'active';
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(now.getTime() - 10 * DAY),
      endsAt: new Date(now.getTime() + (kind === 'expired' ? -DAY : 10 * DAY)),
      revokedAt: kind === 'revoked' ? new Date(now.getTime() - DAY / 2) : null,
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, owner, creator, conversation };
}
type S = Awaited<ReturnType<typeof setup>>;

/** The response without its signed links: those contain the storage path by nature. */
const withoutLinks = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === 'thumbnail_url' || key === 'url' ? '[link]' : v));

let seq = 0;
/** A message of the creator carrying one READY file; returns the attachment id and the asset id. */
async function sendFile(s: S, over: { kind?: 'PHOTO' | 'VIDEO'; body?: string | null } = {}) {
  const assetId = randomUUID();
  const kind = over.kind ?? 'PHOTO';
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      creatorId: s.creator.id,
      clientUploadId: randomUUID(),
      purpose: 'CHAT',
      conversationId: s.conversation.id,
      kind,
      state: 'READY',
      objectKey: `m/${s.creator.id}/${assetId}`,
      declaredType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      declaredBytes: 10n,
      mime: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      sizeBytes: 10n,
      thumbKey: `m/${s.creator.id}/${assetId}/thumb.webp`,
      durationMs: kind === 'VIDEO' ? 42_000 : null,
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: s.conversation.id,
      senderUserId: s.owner.id,
      type: 'MEDIA',
      body: over.body === undefined ? null : over.body,
      clientMessageId: randomUUID(),
      seq: ++seq,
      createdAt: new Date(now.getTime() - 60_000 + seq),
    },
  });
  const attachment = await prisma.messageAttachment.create({
    data: { messageId: message.id, assetId },
  });
  return { attachmentId: attachment.id, assetId };
}

describe('ChatMediaService.list', () => {
  it("lists the conversation's files oldest first with signed thumbnails and no asset ids", async () => {
    const s = await setup();
    const a = await sendFile(s);
    const b = await sendFile(s, { kind: 'VIDEO' });
    const r = await service.list(s.customer.id, s.conversation.id);
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.items.map((i) => i.id)).toEqual([a.attachmentId, b.attachmentId]);
    expect(r.items[1]).toMatchObject({ kind: 'VIDEO', duration_seconds: 42 });
    expect(r.items[0]?.thumbnail_url).toContain('/v1/dev-storage/');
    expect(withoutLinks(r)).not.toContain(a.assetId);
  });

  it("is not_found for another customer's conversation, an unknown id and a malformed id", async () => {
    const s = await setup();
    const other = await setup();
    await sendFile(other);
    expect(await service.list(s.customer.id, other.conversation.id)).toEqual({ kind: 'not_found' });
    expect(await service.list(s.customer.id, randomUUID())).toEqual({ kind: 'not_found' });
    expect(await service.list(s.customer.id, 'nope')).toEqual({ kind: 'not_found' });
    // the creator's own side is not this endpoint
    expect(await service.list(s.owner.id, s.conversation.id)).toEqual({ kind: 'not_found' });
  });
});

describe('ChatMediaService.detail', () => {
  it('gives position, neighbours, message, creator name and a working 5-minute link', async () => {
    const s = await setup();
    const a = await sendFile(s);
    const b = await sendFile(s, { kind: 'VIDEO', body: 'Latihan menguleni adonan roti sobek.' });
    const c = await sendFile(s);
    const r = await service.detail(s.customer.id, s.conversation.id, b.attachmentId);
    if (r.kind !== 'ok') throw new Error(r.kind);
    const d = r.detail;
    expect([d.position, d.total, d.previous_id, d.next_id]).toEqual([
      2,
      3,
      a.attachmentId,
      c.attachmentId,
    ]);
    expect(d.message.body).toBe('Latihan menguleni adonan roti sobek.');
    expect(d.creator.display_name).toBe('Salsa Maheswari');
    expect(d.item).toMatchObject({ id: b.attachmentId, kind: 'VIDEO', duration_seconds: 42 });
    expect(d.original.url).toContain('t=video%2Fmp4');
    expect(new Date(d.original.expires_at).getTime()).toBe(now.getTime() + 5 * 60_000);
    expect(withoutLinks(r)).not.toContain(b.assetId);
    const first = await service.detail(s.customer.id, s.conversation.id, a.attachmentId);
    const last = await service.detail(s.customer.id, s.conversation.id, c.attachmentId);
    if (first.kind !== 'ok' || last.kind !== 'ok') throw new Error('no detail');
    expect([first.detail.position, first.detail.previous_id]).toEqual([1, null]);
    expect([last.detail.position, last.detail.next_id]).toEqual([3, null]);
  });

  it.each(['expired', 'revoked'] as const)(
    'a %s subscription still opens received files',
    async (kind) => {
      const s = await setup({ subscription: kind });
      const f = await sendFile(s);
      expect((await service.detail(s.customer.id, s.conversation.id, f.attachmentId)).kind).toBe(
        'ok',
      );
      expect((await service.list(s.customer.id, s.conversation.id)).kind).toBe('ok');
    },
  );

  it('still opens received files when the creator is blocked', async () => {
    const s = await setup();
    const f = await sendFile(s);
    await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
    expect((await service.detail(s.customer.id, s.conversation.id, f.attachmentId)).kind).toBe(
      'ok',
    );
  });

  it("is not_found for another customer's attachment, an asset id, a gallery asset never sent and the wrong conversation", async () => {
    const s = await setup();
    const mine = await sendFile(s);
    const other = await setup();
    const theirs = await sendFile(other);
    // a second conversation of mine, with another creator
    const second = await setup();
    await prisma.conversation.deleteMany({ where: { id: second.conversation.id } });
    const secondConv = await prisma.conversation.create({
      data: { customerId: s.customer.id, creatorId: second.creator.id },
    });
    const gallery = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: gallery,
        creatorId: s.creator.id,
        clientUploadId: randomUUID(),
        purpose: 'GALLERY',
        kind: 'PHOTO',
        state: 'READY',
        objectKey: `m/${s.creator.id}/${gallery}`,
        declaredType: 'image/jpeg',
        declaredBytes: 10n,
        mime: 'image/jpeg',
        sizeBytes: 10n,
        thumbKey: `m/${s.creator.id}/${gallery}/thumb.webp`,
      },
    });
    const ask = (conv: string, id: string) => service.detail(s.customer.id, conv, id);
    for (const [conv, id] of [
      [s.conversation.id, theirs.attachmentId],
      [other.conversation.id, theirs.attachmentId],
      [s.conversation.id, mine.assetId],
      [s.conversation.id, gallery],
      [secondConv.id, mine.attachmentId],
      [s.conversation.id, randomUUID()],
      [s.conversation.id, 'not-a-uuid'],
      ['not-a-uuid', mine.attachmentId],
    ] as const) {
      expect(await ask(conv, id)).toEqual({ kind: 'not_found' });
    }
  });
});
