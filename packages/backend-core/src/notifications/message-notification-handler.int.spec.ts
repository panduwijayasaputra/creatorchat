import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BotMessage } from './creator-result-message.js';
import { TelegramDeliveryRunner } from './delivery-runner.js';
import {
  messageNotificationHandler,
  PREVIEW_MAX,
  STALE_MS,
} from './message-notification-handler.js';
import { NotificationRouter } from './notification-router.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const T0 = new Date('2026-11-21T10:00:00.000Z');
const MINI = 'https://app.example.test';
const DAY = 86_400_000;

class FakeSender implements TelegramSender {
  calls: { chatId: bigint; message: BotMessage }[] = [];
  script: SendOutcome[] = [];
  async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
    this.calls.push({ chatId, message });
    return this.script.shift() ?? { kind: 'ok', messageId: 800 + this.calls.length };
  }
}

const router = (sender: TelegramSender) =>
  new NotificationRouter(
    prisma,
    new TelegramDeliveryRunner(prisma, sender, { miniAppUrl: MINI, clock: () => T0 }),
    [messageNotificationHandler],
  );

let n = 76_000n;
let seq = 0;
beforeEach(async () => {
  seq = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

async function setup(over: { expired?: boolean } = {}) {
  const customer = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka Putra' },
  });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'gggggggg' },
  });
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(T0.getTime() - 30 * DAY),
      endsAt: new Date(T0.getTime() + (over.expired ? -1 : 10) * DAY),
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, owner, creator, conversation };
}
type S = Awaited<ReturnType<typeof setup>>;

async function say(
  s: S,
  from: 'creator' | 'customer',
  over: { body?: string | null; media?: 'PHOTO' | 'VIDEO'; age?: number } = {},
) {
  seq += 1;
  const message = await prisma.message.create({
    data: {
      conversationId: s.conversation.id,
      senderUserId: from === 'creator' ? s.owner.id : s.customer.id,
      type: over.media ? 'MEDIA' : 'TEXT',
      body: over.body === undefined ? 'halo' : over.body,
      clientMessageId: randomUUID(),
      seq,
    },
  });
  await prisma.conversation.update({
    where: { id: s.conversation.id },
    data: { lastMessageSeq: seq },
  });
  if (over.media) {
    const assetId = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        creatorId: s.creator.id,
        clientUploadId: randomUUID(),
        purpose: 'BROADCAST',
        kind: over.media,
        state: 'READY',
        objectKey: `m/${s.creator.id}/${assetId}`,
        declaredType: over.media === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
        declaredBytes: 10n,
        mime: 'x/y',
        sizeBytes: 9n,
        durationMs: over.media === 'VIDEO' ? 1000 : null,
        thumbKey: `m/${s.creator.id}/${assetId}/thumb.webp`,
      },
    });
    await prisma.messageAttachment.create({ data: { messageId: message.id, assetId } });
  }
  const event = await prisma.outboxEvent.create({
    data: {
      type: 'message.created',
      aggregateType: 'message',
      aggregateId: message.id,
      payload: {},
      dedupeKey: `message:${message.id}:created`,
      status: 'ENQUEUED',
      createdAt: new Date(T0.getTime() - (over.age ?? 40_000)),
    },
  });
  return { message, event };
}

const readAll = (s: S) =>
  prisma.conversationRead.upsert({
    where: { conversationId_userId: { conversationId: s.conversation.id, userId: s.customer.id } },
    create: { conversationId: s.conversation.id, userId: s.customer.id, lastReadSeq: seq },
    update: { lastReadSeq: seq },
  });

const deliveries = () => prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'asc' } });
const eventRow = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

describe('who is told, and how', () => {
  it('tells the customer of a creator message, name only, with a button to the chat', async () => {
    const s = await setup();
    const { event } = await say(s, 'creator', { body: 'Resep rahasia' });
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('sent');
    expect(sender.calls).toEqual([
      {
        chatId: s.customer.telegramId,
        message: {
          text: 'Pesan baru dari Salsa Maheswari.',
          buttonText: 'Buka Aplikasi',
          url: `${MINI}/chats/${s.conversation.id}`,
        },
      },
    ]);
    expect(
      JSON.stringify([sender.calls, await deliveries()], (_k, v) =>
        typeof v === 'bigint' ? String(v) : v,
      ),
    ).not.toContain('Resep rahasia');
    expect((await deliveries())[0]).toMatchObject({ kind: 'chat_message', status: 'SENT' });
  });

  it('tells the creator of a customer message, never with the content', async () => {
    const s = await setup();
    const { event } = await say(s, 'customer', { body: 'Pertanyaan pribadi' });
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('sent');
    expect(sender.calls[0]).toMatchObject({
      chatId: s.owner.telegramId,
      message: { text: 'Pesan baru dari Raka Putra.', url: `${MINI}/inbox/${s.conversation.id}` },
    });
    expect(sender.calls[0]?.message.text).not.toContain('Pertanyaan');
  });

  it('a burst becomes one notification with the count; the others are covered, a later message starts again', async () => {
    const s = await setup();
    const first = await say(s, 'creator');
    const second = await say(s, 'creator');
    const third = await say(s, 'creator');
    const sender = new FakeSender();
    const r = router(sender);
    expect(await r.process(first.event.id)).toBe('sent');
    expect(sender.calls[0]?.message.text).toBe('3 pesan baru dari Salsa Maheswari.');
    expect(await r.process(second.event.id)).toBe('skipped');
    expect(await r.process(third.event.id)).toBe('skipped');
    expect((await deliveries()).map((d) => d.lastErrorCode)).toEqual([
      null,
      'coalesced',
      'coalesced',
    ]);
    const later = await say(s, 'creator');
    expect(await r.process(later.event.id)).toBe('sent');
    expect(sender.calls).toHaveLength(2);
    expect(sender.calls[1]?.message.text).toBe('Pesan baru dari Salsa Maheswari.');
  });

  it('messages processed at the same moment still make one notification (the decision is atomic)', async () => {
    const s = await setup();
    const events = [];
    for (let i = 0; i < 5; i++) events.push((await say(s, 'creator')).event);
    const sender = new FakeSender();
    const results = await Promise.all(events.map((e) => router(sender).process(e.id)));
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'skipped')).toHaveLength(4);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.message.text).toBe('5 pesan baru dari Salsa Maheswari.');
    const rows = await deliveries();
    expect(rows).toHaveLength(5);
    expect(rows.filter((d) => d.lastErrorCode === 'coalesced')).toHaveLength(4);
    expect((await prisma.notificationState.findFirstOrThrow()).lastNotifiedSeq).toBe(5);
  });

  it('a chat the recipient already read is skipped', async () => {
    const s = await setup();
    const { message, event } = await say(s, 'creator');
    await prisma.conversationRead.create({
      data: { conversationId: s.conversation.id, userId: s.customer.id, lastReadSeq: message.seq },
    });
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    expect((await deliveries())[0]?.lastErrorCode).toBe('read');
  });

  it('messages the recipient read are not counted, only the unread ones', async () => {
    const s = await setup();
    const a = await say(s, 'creator');
    const b = await say(s, 'creator');
    await prisma.conversationRead.create({
      data: {
        conversationId: s.conversation.id,
        userId: s.customer.id,
        lastReadSeq: a.message.seq,
      },
    });
    const sender = new FakeSender();
    expect(await router(sender).process(b.event.id)).toBe('sent');
    expect(sender.calls[0]?.message.text).toBe('Pesan baru dari Salsa Maheswari.');
  });

  it("turning message notifications off, or muting this creator, stops the customer's notifications only", async () => {
    const s = await setup();
    const fromCreator = await say(s, 'creator');
    const fromCustomer = await say(s, 'customer');
    await prisma.notificationPreference.create({
      data: { userId: s.customer.id, messagesEnabled: false },
    });
    const sender = new FakeSender();
    const r = router(sender);
    expect(await r.process(fromCreator.event.id)).toBe('skipped');
    expect((await deliveries())[0]?.lastErrorCode).toBe('disabled');
    // the creator is told about the customer's message whatever the customer chose
    expect(await r.process(fromCustomer.event.id)).toBe('sent');

    await prisma.notificationPreference.update({
      where: { userId: s.customer.id },
      data: { messagesEnabled: true },
    });
    await prisma.creatorMute.create({ data: { userId: s.customer.id, creatorId: s.creator.id } });
    const again = await say(s, 'creator');
    expect(await r.process(again.event.id)).toBe('skipped');
    expect((await deliveries()).at(-1)?.lastErrorCode).toBe('muted');
  });
});

describe('the preview', () => {
  it('shows a shortened text only when the customer turned it on', async () => {
    const s = await setup();
    await prisma.notificationPreference.create({
      data: { userId: s.customer.id, showContent: true },
    });
    const long = 'a'.repeat(PREVIEW_MAX + 20);
    const { event } = await say(s, 'creator', { body: long });
    const sender = new FakeSender();
    await router(sender).process(event.id);
    expect(sender.calls[0]?.message.text).toBe(`Salsa Maheswari: ${'a'.repeat(PREVIEW_MAX)}…`);
  });

  it('shows Foto or Video for a message without text, and the text when there is one', async () => {
    const s = await setup();
    await prisma.notificationPreference.create({
      data: { userId: s.customer.id, showContent: true },
    });
    const photo = await say(s, 'creator', { body: null, media: 'PHOTO' });
    const sender = new FakeSender();
    const r = router(sender);
    await r.process(photo.event.id);
    expect(sender.calls[0]?.message.text).toBe('Salsa Maheswari: Foto');
    // the customer read the photo, so only the video is unread
    await readAll(s);
    const video = await say(s, 'creator', { body: null, media: 'VIDEO' });
    await r.process(video.event.id);
    expect(sender.calls[1]?.message.text).toBe('Salsa Maheswari: Video');
    await readAll(s);
    const caption = await say(s, 'creator', { body: 'Promo hari ini', media: 'PHOTO' });
    await r.process(caption.event.id);
    expect(sender.calls[2]?.message.text).toBe('Salsa Maheswari: Promo hari ini');
  });

  it('a burst never shows content, even when it is switched on', async () => {
    const s = await setup();
    await prisma.notificationPreference.create({
      data: { userId: s.customer.id, showContent: true },
    });
    const first = await say(s, 'creator', { body: 'rahasia satu' });
    await say(s, 'creator', { body: 'rahasia dua' });
    const sender = new FakeSender();
    await router(sender).process(first.event.id);
    expect(sender.calls[0]?.message.text).toBe('2 pesan baru dari Salsa Maheswari.');
  });

  it('the creator never gets the content, whatever the customer chose', async () => {
    const s = await setup();
    await prisma.notificationPreference.create({
      data: { userId: s.customer.id, showContent: true },
    });
    const { event } = await say(s, 'customer', { body: 'isi pesan' });
    const sender = new FakeSender();
    await router(sender).process(event.id);
    expect(sender.calls[0]?.message.text).toBe('Pesan baru dari Raka Putra.');
  });
});

describe('who is not told', () => {
  it('a blocked recipient, a recipient who blocked the bot, and a blocked creator get nothing', async () => {
    for (const block of ['customer', 'bot', 'creator'] as const) {
      await resetDatabase(prisma);
      const s = await setup();
      if (block === 'customer') {
        await prisma.user.update({ where: { id: s.customer.id }, data: { status: 'BLOCKED' } });
      }
      if (block === 'bot') {
        await prisma.user.update({ where: { id: s.customer.id }, data: { botBlockedAt: T0 } });
      }
      if (block === 'creator') {
        await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
      }
      const { event } = await say(s, 'creator');
      const sender = new FakeSender();
      expect(await router(sender).process(event.id), block).toBe('skipped');
      expect(sender.calls).toHaveLength(0);
    }
  });

  it('a customer whose access ended is still told about a message they can still read', async () => {
    const s = await setup({ expired: true });
    const { event } = await say(s, 'creator');
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('sent');
  });

  it('an event older than ten minutes is history, not notified', async () => {
    const s = await setup();
    const { event } = await say(s, 'creator', { age: STALE_MS + 1000 });
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    expect((await deliveries())[0]?.lastErrorCode).toBe('stale');
  });

  it('a forged event naming a message that is not there fails without sending', async () => {
    const s = await setup();
    const { event } = await say(s, 'creator');
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { aggregateId: randomUUID() },
    });
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('failed');
    expect((await eventRow(event.id)).lastError).toBe('message_missing');
  });
});

describe('Telegram outcomes', () => {
  it('a retry after a 429 still sends, although the first attempt already marked the burst as told', async () => {
    const s = await setup();
    const first = await say(s, 'creator');
    await say(s, 'creator');
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 2 }];
    const r = router(sender);
    expect(await r.process(first.event.id)).toBe('retry');
    expect((await prisma.notificationState.findFirstOrThrow()).lastNotifiedSeq).toBe(2);
    expect(await r.process(first.event.id)).toBe('sent');
    expect(sender.calls).toHaveLength(2);
    expect(sender.calls[1]?.message.text).toBe('2 pesan baru dari Salsa Maheswari.');
  });

  it('a duplicate job sends once; a blocked bot is flagged; the message itself is untouched', async () => {
    const s = await setup();
    const { message, event } = await say(s, 'creator', { body: 'tetap tersimpan' });
    const sender = new FakeSender();
    sender.script = [{ kind: 'blocked' }];
    const r = router(sender);
    expect(await r.process(event.id)).toBe('blocked');
    expect(await r.process(event.id)).toBe('duplicate');
    expect(sender.calls).toHaveLength(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: s.customer.id } })).botBlockedAt,
    ).toEqual(T0);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      body: 'tetap tersimpan',
    });
  });
});
