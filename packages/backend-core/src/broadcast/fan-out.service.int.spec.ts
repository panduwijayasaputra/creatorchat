import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { BroadcastProcessor } from './broadcast-processor.js';
import { BroadcastService } from './broadcast.service.js';
import { BroadcastFanOutService, RECIPIENT_MAX_ATTEMPTS } from './fan-out.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
let now = new Date('2026-11-21T05:00:00.000Z');
const outbox = new OutboxService();
const broadcasts = new BroadcastService(prisma, outbox, () => now);
const fanOut = new BroadcastFanOutService(prisma, outbox, () => now);
const processor = new BroadcastProcessor(prisma, fanOut);

let n = 68_000n;
beforeEach(async () => {
  now = new Date('2026-11-21T05:00:00.000Z');
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

async function makeCreator() {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: 'eeeeeeea' },
  });
  return { user, creator };
}

async function customer(
  creatorId: string,
  over: { endsInDays?: number; revoked?: boolean; conversation?: boolean } = {},
) {
  const user = await prisma.user.create({ data: { telegramId: n++, displayName: `C${n}` } });
  const subscription = await prisma.subscription.create({
    data: {
      customerId: user.id,
      creatorId,
      startsAt: new Date(now.getTime() - 30 * DAY),
      endsAt: new Date(now.getTime() + (over.endsInDays ?? 10) * DAY),
      revokedAt: over.revoked ? new Date(now.getTime() - 1000) : null,
    },
  });
  if (over.conversation !== false) {
    await prisma.conversation.create({ data: { customerId: user.id, creatorId } });
  }
  return { user, subscription };
}

async function asset(creatorId: string) {
  const id = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: 'BROADCAST',
      kind: 'PHOTO',
      state: 'READY',
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      mime: 'image/jpeg',
      sizeBytes: 9n,
      thumbKey: `m/${creatorId}/${id}/thumb.webp`,
      readyAt: now,
    },
  });
  return id;
}

/** A creator with `active` subscribers, a recorded broadcast and its outbox event. */
async function setup(active = 3, body: string | undefined = 'Promo hari ini') {
  const { user, creator } = await makeCreator();
  const customers = [];
  for (let i = 0; i < active; i++) customers.push(await customer(creator.id));
  const assetId = await asset(creator.id);
  const r = await broadcasts.create(user.id, {
    clientBroadcastId: randomUUID(),
    assetId,
    body,
    saveToGallery: false,
  });
  if (r.kind !== 'created') throw new Error(r.kind);
  const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'broadcast.created' } });
  return { owner: user, creator, customers, assetId, broadcast: r.broadcast, event };
}

const messages = () => prisma.message.findMany({ orderBy: { createdAt: 'asc' } });
const recipients = (broadcastId: string) =>
  prisma.broadcastRecipient.findMany({ where: { broadcastId }, orderBy: { customerId: 'asc' } });
const run = (eventId: string, budgetMs = 10_000, batchSize?: number) =>
  processor.run(eventId, { budgetMs, ...(batchSize ? { batchSize } : {}) });

describe('the fan-out', () => {
  it('writes exactly one message per active subscriber, with the same file and text, and completes', async () => {
    const s = await setup(3);
    await customer(s.creator.id, { endsInDays: -1 }); // expired
    await customer(s.creator.id, { revoked: true });
    const blocked = await customer(s.creator.id);
    await prisma.user.update({ where: { id: blocked.user.id }, data: { status: 'BLOCKED' } });

    expect(await run(s.event.id)).toBe('done');

    const sent = await messages();
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((m) => m.conversationId)).size).toBe(3);
    for (const m of sent) {
      expect(m).toMatchObject({
        senderUserId: s.owner.id,
        type: 'MEDIA',
        body: 'Promo hari ini',
        origin: 'MANUAL',
        broadcastId: s.broadcast.id,
      });
    }
    const attachments = await prisma.messageAttachment.findMany();
    expect(attachments).toHaveLength(3);
    expect(attachments.every((a) => a.assetId === s.assetId)).toBe(true);
    expect(await prisma.mediaAsset.count()).toBe(1);

    const rows = await recipients(s.broadcast.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'DELIVERED' && r.messageId !== null)).toBe(true);
    const done = await prisma.broadcast.findUniqueOrThrow({ where: { id: s.broadcast.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', recipientCount: 3 });
    expect(done.snapshotAt).not.toBeNull();
    expect(done.completedAt).not.toBeNull();
    // every message goes through the normal events; nothing asks for an AI reply
    const types = (await prisma.outboxEvent.findMany()).map((e) => e.type);
    expect(types.filter((t) => t === 'message.created')).toHaveLength(3);
    expect(types.filter((t) => !['message.created', 'broadcast.created'].includes(t))).toEqual([]);
  });

  it('keeps the mode and the response version of every conversation', async () => {
    const s = await setup(2);
    await prisma.conversation.updateMany({ data: { mode: 'AI', responseVersion: 7 } });
    await run(s.event.id);
    const conversations = await prisma.conversation.findMany();
    expect(conversations.every((c) => c.mode === 'AI' && c.responseVersion === 7)).toBe(true);
    expect(conversations.every((c) => c.lastMessageSeq === 1)).toBe(true);
  });

  it('a customer who subscribes after the snapshot gets nothing', async () => {
    const s = await setup(2);
    expect(await fanOut.start(s.broadcast.id)).toBe('started');
    const late = await customer(s.creator.id);
    await fanOut.deliverBatch(s.broadcast.id);
    expect(await fanOut.finish(s.broadcast.id)).toBe(true);
    expect(await messages()).toHaveLength(2);
    expect(
      await prisma.message.count({ where: { conversation: { customerId: late.user.id } } }),
    ).toBe(0);
  });

  it('start is idempotent: a second call neither rebuilds the snapshot nor adds recipients', async () => {
    const s = await setup(2);
    expect(await fanOut.start(s.broadcast.id)).toBe('started');
    await customer(s.creator.id);
    expect(await fanOut.start(s.broadcast.id)).toBe('already_started');
    expect(await recipients(s.broadcast.id)).toHaveLength(2);
    expect(await fanOut.start(randomUUID())).toBe('missing');
  });

  it('a customer whose access ended between the snapshot and the delivery is skipped without a message', async () => {
    const s = await setup(3);
    await fanOut.start(s.broadcast.id);
    const [first, second, third] = s.customers;
    await prisma.subscription.update({
      where: { id: first!.subscription.id },
      data: { revokedAt: now },
    });
    await prisma.subscription.update({
      where: { id: second!.subscription.id },
      data: { endsAt: new Date(now.getTime() - 1000) },
    });
    await prisma.user.update({ where: { id: third!.user.id }, data: { status: 'BLOCKED' } });
    const batch = await fanOut.deliverBatch(s.broadcast.id);
    expect(batch).toMatchObject({ delivered: 0, skipped: 3, remaining: 0 });
    const reasons = Object.fromEntries(
      (await recipients(s.broadcast.id)).map((r) => [r.customerId, r.reason]),
    );
    expect(reasons[first!.user.id]).toBe('access_ended');
    expect(reasons[second!.user.id]).toBe('access_ended');
    expect(reasons[third!.user.id]).toBe('customer_blocked');
    expect(await messages()).toHaveLength(0);
    expect(await fanOut.finish(s.broadcast.id)).toBe(true);
  });

  it('a creator blocked after the snapshot stops the rest, whose recipients are skipped', async () => {
    const s = await setup(4);
    await fanOut.start(s.broadcast.id);
    await fanOut.deliverBatch(s.broadcast.id, 1);
    expect(await messages()).toHaveLength(1);
    await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
    const rest = await fanOut.deliverBatch(s.broadcast.id);
    expect(rest).toMatchObject({ delivered: 0, skipped: 3, remaining: 0 });
    expect(
      (await recipients(s.broadcast.id)).filter((r) => r.reason === 'creator_blocked'),
    ).toHaveLength(3);
    expect(await messages()).toHaveLength(1);
  });

  it('makes the conversation when a snapshot customer has none', async () => {
    const { user, creator } = await makeCreator();
    const lonely = await customer(creator.id, { conversation: false });
    const assetId = await asset(creator.id);
    const r = await broadcasts.create(user.id, {
      clientBroadcastId: randomUUID(),
      assetId,
      saveToGallery: false,
    });
    expect(r.kind).toBe('created');
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { type: 'broadcast.created' },
    });
    expect(await run(event.id)).toBe('done');
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { customerId: lonely.user.id },
    });
    const [m] = await messages();
    expect(m).toMatchObject({ conversationId: conversation.id, body: null, type: 'MEDIA' });
  });
});

describe('retries and crashes never add a second message', () => {
  it('running the processor, or a batch, again after completion changes nothing', async () => {
    const s = await setup(3);
    expect(await run(s.event.id)).toBe('done');
    expect(await run(s.event.id)).toBe('done');
    expect(await fanOut.deliverBatch(s.broadcast.id)).toMatchObject({ delivered: 0, remaining: 0 });
    expect(await messages()).toHaveLength(3);
    expect(await prisma.outboxEvent.count({ where: { type: 'message.created' } })).toBe(3);
  });

  it('resumes after the time budget ran out: continue, then done, still one message each', async () => {
    const s = await setup(5);
    expect(await run(s.event.id, 0, 2)).toBe('continue');
    const partial = await messages();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(5);
    expect(
      await prisma.broadcast.findUniqueOrThrow({ where: { id: s.broadcast.id } }),
    ).toMatchObject({
      status: 'FANNING_OUT',
    });
    expect(await run(s.event.id)).toBe('done');
    expect(await messages()).toHaveLength(5);
    expect(new Set((await messages()).map((m) => m.conversationId)).size).toBe(5);
  });

  it('two workers on one broadcast at once write each message once, without deadlock', async () => {
    const s = await setup(12);
    const [a, b] = await Promise.all([run(s.event.id, 10_000, 4), run(s.event.id, 10_000, 4)]);
    expect([a, b].every((r) => r === 'done' || r === 'continue')).toBe(true);
    expect(await run(s.event.id)).toBe('done');
    expect(await messages()).toHaveLength(12);
    expect(new Set((await messages()).map((m) => m.conversationId)).size).toBe(12);
    expect((await recipients(s.broadcast.id)).every((r) => r.status === 'DELIVERED')).toBe(true);
  });

  it('a recipient that keeps failing for a technical reason is given up after a few tries, the rest still complete', async () => {
    const s = await setup(3);
    await fanOut.start(s.broadcast.id);
    const rows = await recipients(s.broadcast.id);
    const victim = rows[0]!;
    // A message that already holds the recipient's client_message_id makes its delivery fail.
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { customerId: victim.customerId },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: s.owner.id,
        body: 'blokir',
        clientMessageId: victim.id,
        seq: 1,
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageSeq: 1 },
    });
    for (let i = 0; i < RECIPIENT_MAX_ATTEMPTS; i++) await fanOut.deliverBatch(s.broadcast.id);
    const after = await recipients(s.broadcast.id);
    expect(after.find((r) => r.id === victim.id)).toMatchObject({
      status: 'FAILED',
      reason: 'delivery_error',
      attempts: RECIPIENT_MAX_ATTEMPTS,
    });
    expect(after.filter((r) => r.status === 'DELIVERED')).toHaveLength(2);
    expect(await fanOut.finish(s.broadcast.id)).toBe(true);
  });
});

describe('BroadcastProcessor', () => {
  it('answers missing for an unknown event, another event type, or a broadcast that is gone', async () => {
    const s = await setup(1);
    expect(await run(randomUUID())).toBe('missing');
    const other = await prisma.outboxEvent.create({
      data: {
        type: 'other.type',
        aggregateType: 'x',
        aggregateId: s.broadcast.id,
        payload: {},
        dedupeKey: `x:${randomUUID()}`,
      },
    });
    expect(await run(other.id)).toBe('missing');
    const ghost = await prisma.outboxEvent.create({
      data: {
        type: 'broadcast.created',
        aggregateType: 'broadcast',
        aggregateId: randomUUID(),
        payload: {},
        dedupeKey: `x:${randomUUID()}`,
      },
    });
    expect(await run(ghost.id)).toBe('missing');
  });

  it('takes the broadcast from the event row, never from the payload', async () => {
    const s = await setup(2);
    const other = await setup(1).catch(() => null);
    void other;
    await prisma.outboxEvent.update({
      where: { id: s.event.id },
      data: { payload: { broadcast_id: randomUUID(), creator_id: randomUUID() } },
    });
    expect(await run(s.event.id)).toBe('done');
    expect(await messages()).toHaveLength(2);
  });

  it('a broadcast with nobody left at the start completes with no messages', async () => {
    const s = await setup(2);
    await prisma.subscription.updateMany({ data: { revokedAt: now } });
    expect(await run(s.event.id)).toBe('done');
    expect(await messages()).toHaveLength(0);
    expect(
      await prisma.broadcast.findUniqueOrThrow({ where: { id: s.broadcast.id } }),
    ).toMatchObject({
      status: 'COMPLETED',
      recipientCount: 0,
    });
  });
});
