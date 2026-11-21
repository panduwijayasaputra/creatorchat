import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { SubscriptionAccessService } from '../subscription-access/subscription-access.service.js';
import { WelcomeDeliveryService } from './welcome-delivery.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-21T05:00:00.000Z');
const outbox = new OutboxService();
const access = new SubscriptionAccessService(prisma, outbox, () => now);
const welcome = new WelcomeDeliveryService(prisma, outbox, () => now);

let n = 86_000n;
let adminId = '';
beforeEach(async () => {
  now = new Date('2026-11-21T05:00:00.000Z');
  await resetDatabase(prisma);
  adminId = (
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
  ).id;
});
afterAll(() => prisma.$disconnect());

async function makeAsset(creatorId: string, kind: 'gallery' | 'upload') {
  const id = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: kind === 'gallery' ? 'GALLERY' : 'WELCOME',
      kind: 'PHOTO',
      state: 'READY',
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      mime: 'x/y',
      sizeBytes: 9n,
      thumbKey: `m/${creatorId}/${id}/thumb.webp`,
    },
  });
  if (kind === 'gallery') {
    await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: 1 } });
  }
  return id;
}

/** A creator with the welcome message configured and a customer who was just granted access: the event is written. */
async function setup(
  config: {
    enabled?: boolean;
    body?: string | null;
    asset?: 'gallery' | 'upload' | null;
  } | null = {},
) {
  const customer = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka Putra' },
  });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'mmmmmmmm' },
  });
  let assetId: string | null = null;
  if (config !== null) {
    assetId = config.asset ? await makeAsset(creator.id, config.asset) : null;
    await prisma.creatorWelcomeMessage.create({
      data: {
        creatorId: creator.id,
        enabled: config.enabled ?? true,
        body: config.body === undefined ? 'Halo, selamat datang!' : config.body,
        assetId,
      },
    });
  }
  const granted = await access.grant(
    customer.id,
    { creatorId: creator.id, durationDays: 30 },
    { adminId, reason: 'Uji coba.', requestId: 'req-1' },
  );
  if (granted.kind !== 'ok') throw new Error(granted.kind);
  const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'welcome.requested' } });
  return { customer, owner, creator, subscription: granted.subscription, event, assetId };
}

const messages = () => prisma.message.findMany();
const deliveries = () => prisma.welcomeDelivery.findMany();
const expectNothingWritten = async () => {
  expect(await messages()).toHaveLength(0);
  expect(await deliveries()).toHaveLength(0);
};

describe('the welcome message', () => {
  it('is one normal creator message in the new conversation, linked to its delivery row', async () => {
    const s = await setup();
    expect(await welcome.deliver(s.event.id)).toEqual({ kind: 'delivered' });
    const [m] = await messages();
    expect(m).toMatchObject({
      senderUserId: s.owner.id,
      type: 'TEXT',
      body: 'Halo, selamat datang!',
      origin: 'MANUAL',
      broadcastId: null,
      seq: 1,
    });
    const [d] = await deliveries();
    expect(d).toMatchObject({
      creatorId: s.creator.id,
      customerId: s.customer.id,
      messageId: m?.id,
    });
    expect(m?.clientMessageId).toBe(d?.id);
    const conversation = await prisma.conversation.findFirstOrThrow();
    expect(conversation.id).toBe(m?.conversationId);
    expect(conversation.lastMessageSeq).toBe(1);
    // announced like any message; nothing asks for an AI reply
    const types = (await prisma.outboxEvent.findMany()).map((e) => e.type).sort();
    expect(types).toEqual(['message.created', 'subscription.granted', 'welcome.requested']);
  });

  it('keeps the mode and the response version of the conversation', async () => {
    const s = await setup();
    await prisma.conversation.updateMany({ data: { mode: 'AI', responseVersion: 6 } });
    await welcome.deliver(s.event.id);
    expect(await prisma.conversation.findFirstOrThrow()).toMatchObject({
      mode: 'AI',
      responseVersion: 6,
    });
  });

  it('carries a gallery file as the same asset: no copy, no new gallery item', async () => {
    const s = await setup({ asset: 'gallery' });
    await welcome.deliver(s.event.id);
    const [m] = await messages();
    expect(m?.type).toBe('MEDIA');
    const attachments = await prisma.messageAttachment.findMany();
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ messageId: m?.id, assetId: s.assetId });
    expect(await prisma.mediaAsset.count()).toBe(1);
    expect(await prisma.galleryItem.count()).toBe(1);
  });

  it('carries an upload made for it as an attachment of that message only, never in the gallery', async () => {
    const s = await setup({ asset: 'upload' });
    await welcome.deliver(s.event.id);
    expect((await prisma.messageAttachment.findFirstOrThrow()).assetId).toBe(s.assetId);
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('sends the text alone when its file is no longer usable', async () => {
    const s = await setup({ asset: 'upload' });
    await prisma.mediaAsset.update({
      where: { id: s.assetId as string },
      data: {
        state: 'FAILED',
        failureCode: 'UNREADABLE',
        mime: null,
        sizeBytes: null,
        thumbKey: null,
      },
    });
    expect(await welcome.deliver(s.event.id)).toEqual({ kind: 'delivered' });
    expect((await messages())[0]).toMatchObject({ type: 'TEXT', body: 'Halo, selamat datang!' });
    expect(await prisma.messageAttachment.count()).toBe(0);
  });

  it('makes the conversation when there is none', async () => {
    const s = await setup();
    await prisma.conversation.deleteMany();
    expect(await welcome.deliver(s.event.id)).toEqual({ kind: 'delivered' });
    expect(await prisma.conversation.count()).toBe(1);
    expect(await messages()).toHaveLength(1);
  });

  it('uses the text saved at delivery time, and later edits never change a message already sent', async () => {
    const s = await setup({ body: 'Versi lama' });
    await prisma.creatorWelcomeMessage.update({
      where: { creatorId: s.creator.id },
      data: { body: 'Versi baru' },
    });
    await welcome.deliver(s.event.id);
    expect((await messages())[0]?.body).toBe('Versi baru');
    await prisma.creatorWelcomeMessage.update({
      where: { creatorId: s.creator.id },
      data: { body: 'Versi lebih baru' },
    });
    expect((await messages())[0]?.body).toBe('Versi baru');
  });
});

describe('nothing is sent', () => {
  it('while the switch is off, with no configuration at all, and no delivery row is kept', async () => {
    const off = await setup({ enabled: false, body: 'Draf' });
    expect(await welcome.deliver(off.event.id)).toEqual({ kind: 'skipped', reason: 'disabled' });
    await expectNothingWritten();
    await resetDatabase(prisma);
    adminId = (
      await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
    ).id;
    const none = await setup(null);
    expect(await welcome.deliver(none.event.id)).toEqual({ kind: 'skipped', reason: 'disabled' });
    await expectNothingWritten();
  });

  it('when the access ended, was revoked, or the accounts are blocked before delivery', async () => {
    for (const change of ['ended', 'revoked', 'customer', 'creator', 'creator-account'] as const) {
      await resetDatabase(prisma);
      adminId = (
        await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
      ).id;
      const s = await setup();
      if (change === 'ended') {
        await prisma.subscription.update({
          where: { id: s.subscription.id },
          data: {
            endsAt: new Date(now.getTime() - 1000),
            startsAt: new Date(now.getTime() - 40 * 86_400_000),
          },
        });
      }
      if (change === 'revoked') {
        await prisma.subscription.update({
          where: { id: s.subscription.id },
          data: { revokedAt: now },
        });
      }
      if (change === 'customer') {
        await prisma.user.update({ where: { id: s.customer.id }, data: { status: 'BLOCKED' } });
      }
      if (change === 'creator') {
        await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
      }
      if (change === 'creator-account') {
        await prisma.user.update({ where: { id: s.owner.id }, data: { status: 'BLOCKED' } });
      }
      const outcome = await welcome.deliver(s.event.id);
      expect(outcome.kind, change).toBe('skipped');
      expect(await messages(), change).toHaveLength(0);
      expect(await deliveries(), change).toHaveLength(0);
    }
  });

  it('reports the reason for each refusal', async () => {
    const ended = await setup();
    await prisma.subscription.update({
      where: { id: ended.subscription.id },
      data: { revokedAt: now },
    });
    expect(await welcome.deliver(ended.event.id)).toEqual({
      kind: 'skipped',
      reason: 'access_ended',
    });
  });
});

describe('at most one per creator and customer', () => {
  it('a repeated event, a retry and a re-run after completion write nothing more', async () => {
    const s = await setup();
    expect(await welcome.deliver(s.event.id)).toEqual({ kind: 'delivered' });
    expect(await welcome.deliver(s.event.id)).toEqual({ kind: 'duplicate' });
    expect(await welcome.deliver(s.event.id)).toEqual({ kind: 'duplicate' });
    expect(await messages()).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
    expect(await prisma.outboxEvent.count({ where: { type: 'message.created' } })).toBe(1);
  });

  it('two jobs at once write one message and one delivery row', async () => {
    const s = await setup();
    const results = await Promise.all([welcome.deliver(s.event.id), welcome.deliver(s.event.id)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['delivered', 'duplicate']);
    expect(await messages()).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
  });

  it('a delivery row exists only together with its message', async () => {
    const s = await setup();
    await welcome.deliver(s.event.id);
    const [d] = await deliveries();
    expect(d?.messageId).not.toBeNull();
  });

  it('a later grant (extension, re-grant) does not bring a second one', async () => {
    const s = await setup();
    await welcome.deliver(s.event.id);
    now = new Date(now.getTime() + 40 * 86_400_000);
    await access.grant(
      s.customer.id,
      { creatorId: s.creator.id, durationDays: 30 },
      { adminId, reason: 'Perpanjang.', requestId: 'req-2' },
    );
    expect(await prisma.outboxEvent.count({ where: { type: 'welcome.requested' } })).toBe(1);
    expect(await messages()).toHaveLength(1);
  });
});

describe('unknown input', () => {
  it('an unknown event, another event type and a subscription that is gone are missing', async () => {
    const s = await setup();
    expect(await welcome.deliver(randomUUID())).toEqual({ kind: 'missing' });
    const other = await prisma.outboxEvent.create({
      data: {
        type: 'other.type',
        aggregateType: 'subscription',
        aggregateId: s.subscription.id,
        payload: {},
        dedupeKey: `x:${randomUUID()}`,
      },
    });
    expect(await welcome.deliver(other.id)).toEqual({ kind: 'missing' });
    const ghost = await prisma.outboxEvent.create({
      data: {
        type: 'welcome.requested',
        aggregateType: 'subscription',
        aggregateId: randomUUID(),
        payload: {},
        dedupeKey: `x:${randomUUID()}`,
      },
    });
    expect(await welcome.deliver(ghost.id)).toEqual({ kind: 'missing' });
    await expectNothingWritten();
  });

  it('takes customer and creator from the subscription, never from the payload', async () => {
    const s = await setup();
    const stranger = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Orang Lain' },
    });
    await prisma.outboxEvent.update({
      where: { id: s.event.id },
      data: { payload: { customer_id: stranger.id, creator_id: randomUUID() } },
    });
    await welcome.deliver(s.event.id);
    expect((await deliveries())[0]?.customerId).toBe(s.customer.id);
  });
});
