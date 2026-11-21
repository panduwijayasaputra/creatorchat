import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 94_000n;
const ids = { customer: '', owner: '', creator: '', conversation: '', asset: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'abcdefgh' },
  });
  ids.customer = customer.id;
  ids.owner = owner.id;
  ids.creator = creator.id;
  ids.conversation = (
    await prisma.conversation.create({ data: { customerId: customer.id, creatorId: creator.id } })
  ).id;
  const assetId = randomUUID();
  ids.asset = (
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        creatorId: creator.id,
        clientUploadId: randomUUID(),
        purpose: 'BROADCAST',
        kind: 'PHOTO',
        objectKey: `m/${creator.id}/${assetId}`,
        declaredType: 'image/jpeg',
        declaredBytes: 10n,
      },
    })
  ).id;
});
afterAll(() => prisma.$disconnect());

const broadcast = (over: Record<string, unknown> = {}) =>
  prisma.broadcast.create({
    data: {
      creatorId: ids.creator,
      clientBroadcastId: randomUUID(),
      assetId: ids.asset,
      ...over,
    },
  });

let seq = 0;
const message = (over: Record<string, unknown> = {}) =>
  prisma.message.create({
    data: {
      conversationId: ids.conversation,
      senderUserId: ids.owner,
      type: 'MEDIA',
      body: null,
      clientMessageId: randomUUID(),
      seq: ++seq,
      ...over,
    },
  });

describe('media purposes', () => {
  it('accepts BROADCAST and WELCOME assets without a conversation, refuses a conversation on them', async () => {
    const id = randomUUID();
    const make = (purpose: 'WELCOME' | 'BROADCAST', conversationId: string | null) =>
      prisma.mediaAsset.create({
        data: {
          id,
          creatorId: ids.creator,
          clientUploadId: randomUUID(),
          purpose,
          kind: 'VIDEO',
          objectKey: `m/${ids.creator}/${randomUUID()}`,
          declaredType: 'video/mp4',
          declaredBytes: 10n,
          conversationId,
        },
      });
    await make('WELCOME', null);
    await expect(make('BROADCAST', ids.conversation)).rejects.toThrow();
  });
});

describe('broadcasts', () => {
  it('starts QUEUED; the text is optional, 1–2000 characters', async () => {
    expect((await broadcast()).status).toBe('QUEUED');
    await broadcast({ body: 'Promo hari ini' });
    await expect(broadcast({ body: '' })).rejects.toThrow();
    await expect(broadcast({ body: 'a'.repeat(2001) })).rejects.toThrow();
  });

  it('one row per (creator, client_broadcast_id)', async () => {
    const clientBroadcastId = randomUUID();
    await broadcast({ clientBroadcastId });
    await expect(broadcast({ clientBroadcastId })).rejects.toThrow();
  });

  it('a recipient is DELIVERED exactly when it has a message', async () => {
    const b = await broadcast();
    const make = (customerId: string, over: Record<string, unknown>) =>
      prisma.broadcastRecipient.create({ data: { broadcastId: b.id, customerId, ...over } });
    await make(ids.customer, { status: 'DELIVERED' }).then(
      () => {
        throw new Error('should have been refused');
      },
      () => undefined,
    );
    const m = await message({ broadcastId: b.id });
    const row = await make(ids.customer, { status: 'DELIVERED', messageId: m.id });
    expect(row.attempts).toBe(0);
    const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'D' } });
    await expect(make(other.id, { status: 'PENDING', messageId: m.id })).rejects.toThrow();
  });

  it('one recipient row per customer; reasons are short codes', async () => {
    const b = await broadcast();
    await prisma.broadcastRecipient.create({
      data: {
        broadcastId: b.id,
        customerId: ids.customer,
        status: 'SKIPPED',
        reason: 'access_ended',
      },
    });
    await expect(
      prisma.broadcastRecipient.create({ data: { broadcastId: b.id, customerId: ids.customer } }),
    ).rejects.toThrow();
    const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'D' } });
    await expect(
      prisma.broadcastRecipient.create({
        data: { broadcastId: b.id, customerId: other.id, status: 'SKIPPED', reason: 'Not A Code' },
      }),
    ).rejects.toThrow();
  });

  it('a conversation holds at most one message of a broadcast; ordinary messages are unaffected', async () => {
    const b = await broadcast();
    await message({ broadcastId: b.id });
    await expect(message({ broadcastId: b.id })).rejects.toThrow();
    await message();
    await message();
  });
});
