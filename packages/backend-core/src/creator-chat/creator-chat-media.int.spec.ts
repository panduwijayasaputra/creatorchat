import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatService } from '../chat/chat.service.js';
import { ChatListService } from '../chat/chat-list.service.js';
import { CreatorInboxService } from '../creator-inbox/creator-inbox.service.js';
import { MediaAccessService } from '../media/media-access.service.js';
import { LocalDiskStorage } from '../media/storage/local-disk-storage.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { CreatorChatService } from './creator-chat.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
let dir: string;
let now = new Date('2026-11-18T05:00:00.000Z');
let creatorChat: CreatorChatService;
let customerChat: ChatService;
let n = 92_000n;
let codeNo = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-chat-media-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
beforeEach(async () => {
  now = new Date('2026-11-18T05:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
  const storage = new LocalDiskStorage(dir, 's'.repeat(40), 'http://api.test', () => now);
  const access = new MediaAccessService(prisma, storage);
  creatorChat = new CreatorChatService(prisma, new OutboxService(), () => now, access);
  customerChat = new ChatService(prisma, new OutboxService(), () => now, access);
});

const ms = (d: number) => new Date(now.getTime() + d);

async function setup(over: { subscription?: 'active' | 'expired' | 'revoked' } = {}) {
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'Rani' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `fffffff${'abcdefgh'[codeNo++]}` },
  });
  const kind = over.subscription ?? 'active';
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: ms(-10 * DAY),
      endsAt: kind === 'expired' ? ms(-DAY) : ms(10 * DAY),
      revokedAt: kind === 'revoked' ? ms(-DAY / 2) : null,
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, owner, creator, conversation };
}
type S = Awaited<ReturnType<typeof setup>>;

let galleryNo = 0;
async function asset(
  creatorId: string,
  over: {
    purpose?: 'GALLERY' | 'CHAT';
    conversationId?: string;
    state?: 'READY' | 'PROCESSING' | 'FAILED';
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
      purpose: over.purpose ?? 'GALLERY',
      ...(over.conversationId ? { conversationId: over.conversationId } : {}),
      kind,
      state,
      objectKey: `m/${creatorId}/${id}`,
      declaredType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
      declaredBytes: 10n,
      ...(state === 'READY'
        ? {
            mime: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
            sizeBytes: 10n,
            thumbKey: `m/${creatorId}/${id}/thumb.webp`,
            durationMs: kind === 'VIDEO' ? 48_000 : null,
            readyAt: now,
          }
        : {}),
    },
  });
  if (over.gallery) {
    await prisma.galleryItem.create({
      data: { creatorId, assetId: id, seq: ++galleryNo },
    });
  }
  return id;
}
const galleryAsset = (s: S, over = {}) => asset(s.creator.id, { gallery: true, ...over });
const chatAsset = (s: S, over = {}) =>
  asset(s.creator.id, { purpose: 'CHAT', conversationId: s.conversation.id, ...over });

const send = (
  s: S,
  input: { body?: string; attachmentAssetId?: string; clientMessageId?: string } = {},
  conversationId = s.conversation.id,
) =>
  creatorChat.send(s.owner.id, conversationId, {
    clientMessageId: input.clientMessageId ?? randomUUID(),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.attachmentAssetId ? { attachmentAssetId: input.attachmentAssetId } : {}),
  });

const counts = async () => ({
  messages: await prisma.message.count(),
  attachments: await prisma.messageAttachment.count(),
  outbox: await prisma.outboxEvent.count(),
  assets: await prisma.mediaAsset.count(),
  gallery: await prisma.galleryItem.count(),
});

describe('sending a gallery asset', () => {
  it('stores one MEDIA message pointing at the same asset, copies nothing and writes one outbox event', async () => {
    const s = await setup();
    const id = await galleryAsset(s);
    const before = await counts();
    const r = await send(s, { attachmentAssetId: id });
    if (r.kind !== 'created') throw new Error(r.kind);
    expect(r.message).toMatchObject({ type: 'MEDIA', body: null, origin: 'MANUAL', sender: 'ME' });
    expect(r.message.attachments).toHaveLength(1);
    expect(r.message.attachments[0]).toMatchObject({ id, kind: 'PHOTO' });
    expect(r.message.attachments[0]?.thumbnailUrl).toContain('/v1/dev-storage/');
    const rows = await prisma.messageAttachment.findMany();
    expect(rows.map((x) => x.assetId)).toEqual([id]);
    const after = await counts();
    expect(after).toEqual({
      ...before,
      messages: before.messages + 1,
      attachments: before.attachments + 1,
      outbox: before.outbox + 1,
    });
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversation.id } });
    expect(conv.lastMessageAt).not.toBeNull();
  });

  it('the same gallery asset can be sent again in a later message', async () => {
    const s = await setup();
    const id = await galleryAsset(s);
    expect((await send(s, { attachmentAssetId: id })).kind).toBe('created');
    expect((await send(s, { attachmentAssetId: id })).kind).toBe('created');
    expect(await prisma.messageAttachment.count({ where: { assetId: id } })).toBe(2);
  });

  it('carries a message text along, trimmed', async () => {
    const s = await setup();
    const id = await galleryAsset(s, { kind: 'VIDEO' });
    const r = await send(s, { attachmentAssetId: id, body: '  lihat ini  ' });
    if (r.kind !== 'created') throw new Error(r.kind);
    expect(r.message.body).toBe('lihat ini');
    expect(r.message.attachments[0]).toMatchObject({ kind: 'VIDEO', durationSeconds: 48 });
  });
});

describe('sending a chat upload', () => {
  it('attaches in its own conversation once, and a second use is media_not_found', async () => {
    const s = await setup();
    const id = await chatAsset(s);
    expect((await send(s, { attachmentAssetId: id })).kind).toBe('created');
    expect(await send(s, { attachmentAssetId: id })).toEqual({ kind: 'media_not_found' });
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('is media_not_found in another conversation of the same creator', async () => {
    const s = await setup();
    const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'Dewi' } });
    await prisma.subscription.create({
      data: { customerId: other.id, creatorId: s.creator.id, startsAt: ms(-DAY), endsAt: ms(DAY) },
    });
    const second = await prisma.conversation.create({
      data: { customerId: other.id, creatorId: s.creator.id },
    });
    const id = await chatAsset(s);
    expect(await send(s, { attachmentAssetId: id }, second.id)).toEqual({
      kind: 'media_not_found',
    });
  });

  it("is media_not_found for another creator's asset, an asset outside the gallery, a FAILED one and a malformed id", async () => {
    const s = await setup();
    const other = await setup();
    const theirs = await galleryAsset(other);
    const outside = await asset(s.creator.id, { gallery: false });
    const failed = await chatAsset(s, { state: 'FAILED' });
    for (const id of [theirs, outside, failed, randomUUID(), 'not-a-uuid']) {
      expect(await send(s, { attachmentAssetId: id })).toEqual({ kind: 'media_not_found' });
    }
    expect((await counts()).messages).toBe(0);
  });

  it('answers media_not_ready while the file is still processed', async () => {
    const s = await setup();
    const id = await chatAsset(s, { state: 'PROCESSING' });
    expect(await send(s, { attachmentAssetId: id })).toEqual({ kind: 'media_not_ready' });
    expect((await counts()).messages).toBe(0);
  });

  it('two sends of the same chat asset in parallel: exactly one succeeds', async () => {
    const s = await setup();
    const id = await chatAsset(s);
    const results = await Promise.all([
      send(s, { attachmentAssetId: id }),
      send(s, { attachmentAssetId: id }),
      send(s, { attachmentAssetId: id }),
    ]);
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'media_not_found')).toHaveLength(2);
    expect(await prisma.messageAttachment.count()).toBe(1);
  });
});

describe('retries and validation', () => {
  it('the same client id and asset returns the stored message; another asset, or text, conflicts', async () => {
    const s = await setup();
    const a = await galleryAsset(s);
    const b = await galleryAsset(s);
    const clientMessageId = randomUUID();
    const first = await send(s, { attachmentAssetId: a, clientMessageId });
    const again = await send(s, { attachmentAssetId: a, clientMessageId });
    if (first.kind !== 'created' || again.kind !== 'replayed') throw new Error('no replay');
    expect(again.message.id).toBe(first.message.id);
    expect(again.message.attachments).toHaveLength(1);
    expect(await send(s, { attachmentAssetId: b, clientMessageId })).toEqual({ kind: 'conflict' });
    expect(await send(s, { body: 'teks', clientMessageId })).toEqual({ kind: 'conflict' });
    expect((await counts()).messages).toBe(1);
  });

  it('refuses neither text nor file, an empty text and a too long text', async () => {
    const s = await setup();
    expect(await send(s, {})).toEqual({ kind: 'invalid' });
    expect(await send(s, { body: '   ' })).toEqual({ kind: 'invalid' });
    expect(await send(s, { body: 'a'.repeat(2001) })).toEqual({ kind: 'invalid' });
    expect((await counts()).messages).toBe(0);
  });

  it.each(['expired', 'revoked'] as const)(
    'a %s customer: access_expired and nothing is stored',
    async (kind) => {
      const s = await setup({ subscription: kind });
      const id = await galleryAsset(s);
      const before = await counts();
      expect(await send(s, { attachmentAssetId: id })).toEqual({ kind: 'access_expired' });
      expect(await counts()).toEqual(before);
    },
  );
});

describe('history and previews', () => {
  it('both sides see the attachment, TEXT messages stay plain, and the file stays readable after expiry', async () => {
    const s = await setup();
    const id = await galleryAsset(s);
    await send(s, { body: 'halo' });
    await send(s, { attachmentAssetId: id });
    const mine = await creatorChat.history(s.owner.id, s.conversation.id, { limit: 10 });
    if (mine.kind !== 'ok') throw new Error(mine.kind);
    const [media, text] = mine.history.items;
    expect(media?.attachments[0]?.id).toBe(id);
    expect(text).toMatchObject({ type: 'TEXT', body: 'halo', attachments: [] });

    await prisma.subscription.updateMany({ data: { endsAt: ms(-1000) } });
    const theirs = await customerChat.history(s.customer.id, s.conversation.id, { limit: 10 });
    if (theirs.kind !== 'ok') throw new Error(theirs.kind);
    expect(theirs.history.items[0]).toMatchObject({ type: 'MEDIA', body: null });
    expect(theirs.history.items[0]?.attachments[0]).toMatchObject({ id, kind: 'PHOTO' });
    expect(theirs.history.conversation.access.state).toBe('EXPIRED');
  });

  it('the chat list and the inbox show an empty preview and the media kind for a media-only message', async () => {
    const s = await setup();
    const video = await galleryAsset(s, { kind: 'VIDEO' });
    await send(s, { attachmentAssetId: video });
    const list = await new ChatListService(prisma, () => now).list(s.customer.id, { limit: 20 });
    if (list.kind !== 'ok') throw new Error(list.kind);
    expect(list.items[0]?.lastMessage).toMatchObject({ preview: '', mediaKind: 'VIDEO' });
    const inbox = await new CreatorInboxService(prisma, () => now).list(s.owner.id, {
      filter: 'all',
      limit: 20,
    });
    if (inbox.kind !== 'ok') throw new Error(inbox.kind);
    expect(inbox.items[0]).toMatchObject({ preview: '', previewMediaKind: 'VIDEO' });

    await send(s, { body: 'sudah kulihat' });
    const after = await new ChatListService(prisma, () => now).list(s.customer.id, { limit: 20 });
    if (after.kind !== 'ok') throw new Error(after.kind);
    expect(after.items[0]?.lastMessage).toMatchObject({
      preview: 'sudah kulihat',
      mediaKind: null,
    });
  });

  it('a stranger gets no thumbnail link for a file of this conversation', async () => {
    const s = await setup();
    const id = await galleryAsset(s);
    await send(s, { attachmentAssetId: id });
    const storage = new LocalDiskStorage(dir, 's'.repeat(40), 'http://api.test', () => now);
    const access = new MediaAccessService(prisma, storage);
    const stranger = await prisma.user.create({ data: { telegramId: n++, displayName: 'X' } });
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
    expect((await access.thumbnailUrlsForParticipant(stranger.id, [asset])).size).toBe(0);
    expect((await access.thumbnailUrlsForParticipant(s.customer.id, [asset])).size).toBe(1);
    expect((await access.thumbnailUrlsForParticipant(s.owner.id, [asset])).size).toBe(1);
  });
});
