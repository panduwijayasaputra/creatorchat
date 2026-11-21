import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { writeCreatorMessage } from './message-writer.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const outbox = new OutboxService();
const now = new Date('2026-11-21T05:00:00.000Z');

let n = 66_000n;
const ids = { owner: '', conversation: '', asset: '', creator: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'dddddddd' },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id, mode: 'AI', responseVersion: 4 },
  });
  const assetId = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      creatorId: creator.id,
      clientUploadId: randomUUID(),
      purpose: 'BROADCAST',
      kind: 'PHOTO',
      state: 'READY',
      objectKey: `m/${creator.id}/${assetId}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      mime: 'image/jpeg',
      sizeBytes: 9n,
      thumbKey: `m/${creator.id}/${assetId}/thumb.webp`,
    },
  });
  Object.assign(ids, {
    owner: owner.id,
    creator: creator.id,
    conversation: conversation.id,
    asset: assetId,
  });
});
afterAll(() => prisma.$disconnect());

const write = (over: Partial<Parameters<typeof writeCreatorMessage>[2]> = {}) =>
  prisma.$transaction((tx) =>
    writeCreatorMessage(tx, outbox, {
      conversationId: ids.conversation,
      creatorUserId: ids.owner,
      clientMessageId: randomUUID(),
      body: 'halo',
      assetId: null,
      now,
      ...over,
    }),
  );

describe('writeCreatorMessage', () => {
  it('numbers messages one after the other and writes one message.created event each', async () => {
    const a = await write();
    const b = await write({ body: 'lagi' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a).toMatchObject({ type: 'TEXT', origin: 'MANUAL', body: 'halo', broadcastId: null });
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: ids.conversation },
    });
    expect(conversation.lastMessageSeq).toBe(2);
    expect(conversation.lastMessageAt).toEqual(now);
    const events = await prisma.outboxEvent.findMany({ where: { type: 'message.created' } });
    expect(events.map((e) => e.aggregateId).sort()).toEqual([a.id, b.id].sort());
    expect(events[0]?.payload).toMatchObject({
      conversation_id: ids.conversation,
      sender_id: ids.owner,
    });
  });

  it('writes a media message with one attachment, with or without text', async () => {
    const m = await write({ body: null, assetId: ids.asset });
    expect(m).toMatchObject({ type: 'MEDIA', body: null });
    const attachments = await prisma.messageAttachment.findMany({ where: { messageId: m.id } });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ assetId: ids.asset, position: 0 });
  });

  it('never changes the mode or the response version of the conversation', async () => {
    await write({ assetId: ids.asset });
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: ids.conversation },
    });
    expect(conversation).toMatchObject({ mode: 'AI', responseVersion: 4 });
  });

  it('rolls back with the transaction: no message, no number used, no event', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await writeCreatorMessage(tx, outbox, {
          conversationId: ids.conversation,
          creatorUserId: ids.owner,
          clientMessageId: randomUUID(),
          body: 'x',
          assetId: null,
          now,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: ids.conversation } }))
        .lastMessageSeq,
    ).toBe(0);
  });

  it('stores the broadcast link, and the same broadcast cannot write twice into one conversation', async () => {
    const b = await prisma.broadcast.create({
      data: { creatorId: ids.creator, clientBroadcastId: randomUUID(), assetId: ids.asset },
    });
    const m = await write({ assetId: ids.asset, broadcastId: b.id });
    expect(m.broadcastId).toBe(b.id);
    await expect(write({ assetId: ids.asset, broadcastId: b.id })).rejects.toThrow();
    expect(await prisma.message.count()).toBe(1);
  });

  it('a repeated client_message_id for the same conversation and sender is refused by the database', async () => {
    const clientMessageId = randomUUID();
    await write({ clientMessageId });
    await expect(write({ clientMessageId })).rejects.toThrow();
  });
});
