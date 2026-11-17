import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 93_000n;
const ids = { customer: '', creator: '', conversation: '', other: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'abcdefgh' },
  });
  const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'D' } });
  ids.customer = customer.id;
  ids.creator = creator.id;
  ids.other = other.id;
  ids.conversation = (
    await prisma.conversation.create({ data: { customerId: customer.id, creatorId: creator.id } })
  ).id;
});
afterAll(() => prisma.$disconnect());

let seq = 0;
const message = (over: Record<string, unknown> = {}) =>
  prisma.message.create({
    data: {
      conversationId: ids.conversation,
      senderUserId: ids.customer,
      body: 'halo',
      clientMessageId: randomUUID(),
      seq: ++seq,
      ...over,
    },
  });

const asset = (over: Record<string, unknown> = {}) => {
  const id = randomUUID();
  return prisma.mediaAsset.create({
    data: {
      id,
      creatorId: ids.creator,
      clientUploadId: randomUUID(),
      purpose: 'GALLERY',
      kind: 'PHOTO',
      objectKey: `m/${ids.creator}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      ...over,
    },
  });
};

describe('MEDIA messages', () => {
  it('a TEXT message must have a body; a MEDIA message may have none', async () => {
    await expect(message({ type: 'TEXT', body: null })).rejects.toThrow();
    await message({ type: 'MEDIA', body: null });
    await message({ type: 'MEDIA', body: 'lihat ini' });
  });

  it('the text limit still holds for both types, and an empty text is refused', async () => {
    await expect(message({ type: 'MEDIA', body: 'a'.repeat(2001) })).rejects.toThrow();
    await expect(message({ type: 'MEDIA', body: '' })).rejects.toThrow();
    await message({ type: 'MEDIA', body: 'a'.repeat(2000) });
  });
});

describe('chat-only assets', () => {
  it('a CHAT asset needs a conversation and a gallery asset must not have one', async () => {
    await expect(asset({ purpose: 'CHAT' })).rejects.toThrow();
    await expect(asset({ purpose: 'GALLERY', conversationId: ids.conversation })).rejects.toThrow();
    const chat = await asset({ purpose: 'CHAT', conversationId: ids.conversation });
    expect(chat.conversationId).toBe(ids.conversation);
    await asset();
  });

  it('refuses to delete a conversation that owns a chat upload', async () => {
    await asset({ purpose: 'CHAT', conversationId: ids.conversation });
    await expect(prisma.conversation.delete({ where: { id: ids.conversation } })).rejects.toThrow();
  });
});

describe('message_attachments', () => {
  it('ties a message to an asset, one per position', async () => {
    const m = await message({ type: 'MEDIA', body: null });
    const a = await asset();
    await prisma.messageAttachment.create({ data: { messageId: m.id, assetId: a.id } });
    await expect(
      prisma.messageAttachment.create({ data: { messageId: m.id, assetId: (await asset()).id } }),
    ).rejects.toThrow();
    await prisma.messageAttachment.create({
      data: { messageId: m.id, assetId: (await asset()).id, position: 1 },
    });
  });

  it('the same gallery asset may be attached to many messages (no copy)', async () => {
    const a = await asset();
    const first = await message({ type: 'MEDIA', body: null });
    const second = await message({ type: 'MEDIA', body: null });
    await prisma.messageAttachment.create({ data: { messageId: first.id, assetId: a.id } });
    await prisma.messageAttachment.create({ data: { messageId: second.id, assetId: a.id } });
    expect(await prisma.messageAttachment.count({ where: { assetId: a.id } })).toBe(2);
    expect(await prisma.mediaAsset.count()).toBe(1);
  });

  it('refuses to delete an attached asset or a message that has an attachment', async () => {
    const m = await message({ type: 'MEDIA', body: null });
    const a = await asset();
    await prisma.messageAttachment.create({ data: { messageId: m.id, assetId: a.id } });
    await expect(prisma.mediaAsset.delete({ where: { id: a.id } })).rejects.toThrow();
    await expect(prisma.message.delete({ where: { id: m.id } })).rejects.toThrow();
  });
});
