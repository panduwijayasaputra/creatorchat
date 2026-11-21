import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  AccountSecurityService,
  CreatorApprovalService,
  CreatorChatService,
  OutboxService,
  SubscriptionAccessService,
  type BotMessage,
  type SendOutcome,
  type TelegramSender,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startNotifications, type Notifications } from './notifications.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prefix = `test:bull:${randomUUID()}`;
const TOKEN = '123456:SECRET-bot-token';
const env = {
  REDIS_URL: redisUrl,
  TELEGRAM_BOT_TOKEN: TOKEN,
  MINIAPP_URL: 'https://app.example.test',
};

class FakeSender implements TelegramSender {
  calls: { chatId: bigint; message: BotMessage }[] = [];
  script: SendOutcome[] = [];
  async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
    this.calls.push({ chatId, message });
    return this.script.shift() ?? { kind: 'ok', messageId: 500 + this.calls.length };
  }
}

let raw = '';
const logger = pino(
  { level: 'info' },
  new Writable({ write: (c, _e, cb) => ((raw += String(c)), cb()) }),
);
let running: Notifications | null = null;
let adminId = '';
let n = 70_000n;

const start = (
  sender: TelegramSender,
  extra: Partial<Parameters<typeof startNotifications>[0]> = {},
) => {
  running = startNotifications({
    env,
    prisma,
    logger,
    sender,
    queuePrefix: prefix,
    intervalMs: 50,
    reconcileMs: 200,
    ...extra,
  });
  return running;
};
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end)
      throw new Error(
        'timed out: ' +
          raw.slice(-1500) +
          JSON.stringify(
            await prisma.outboxEvent.findMany({ select: { status: true, lastError: true } }),
          ),
      );
    await new Promise((r) => setTimeout(r, 40));
  }
};

async function pendingRequest() {
  const user = await prisma.user.create({ data: { telegramId: n++, displayName: 'Maya' } });
  const application = await prisma.creatorApplication.create({
    data: {
      userId: user.id,
      creatorName: 'Maya',
      instagramUrl: 'https://instagram.com/maya',
      creatorType: 'HUMAN',
      description: 'd',
    },
  });
  return { user, application };
}
const approvals = () => new CreatorApprovalService(prisma, new AccountSecurityService(prisma));

beforeEach(async () => {
  raw = '';
  await resetDatabase(prisma);
  adminId = (
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
  ).id;
});
afterEach(async () => {
  await running?.stop();
  running = null;
});
afterAll(async () => {
  const redis = new Redis(redisUrl);
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
  await prisma.$disconnect();
});

describe('creator result pipeline (real PostgreSQL and Redis, fake Telegram)', () => {
  it('an approval sends exactly one message and settles the event and delivery', async () => {
    const { user, application } = await pendingRequest();
    const sender = new FakeSender();
    start(sender);
    const result = await approvals().approve(application.id, { adminId });
    expect(result.kind).toBe('ok');

    await until(async () => (await prisma.outboxEvent.findFirst())?.status === 'DONE');
    await new Promise((r) => setTimeout(r, 500)); // room for a wrongful second send
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.chatId).toBe(user.telegramId);
    expect(sender.calls[0]?.message.text).toContain('Selamat, permintaanmu disetujui');
    expect(await prisma.notificationDelivery.findFirst()).toMatchObject({
      status: 'SENT',
      attempts: 1,
    });
    expect(raw).not.toContain('SECRET');
  });

  it('a rejection sends the placeholder with the reason', async () => {
    const { application } = await pendingRequest();
    const sender = new FakeSender();
    start(sender);
    await approvals().reject(application.id, { reason: 'Link belum valid.' }, { adminId });
    await until(() => sender.calls.length === 1);
    expect(sender.calls[0]?.message.text).toContain('Alasan dari admin: Link belum valid.');
  });

  it('sends once after the loops were killed between enqueue and send, and restarted', async () => {
    const { application } = await pendingRequest();
    await approvals().approve(application.id, { adminId });
    // Simulate the crash: the dispatcher marked it ENQUEUED, but no job exists and nothing consumed it.
    await prisma.outboxEvent.updateMany({
      data: { status: 'ENQUEUED', enqueuedAt: new Date(Date.now() - 10 * 60_000) },
    });
    const sender = new FakeSender();
    start(sender, { staleEnqueuedMs: 1000 });
    await until(() => sender.calls.length === 1);
    await until(async () => (await prisma.outboxEvent.findFirst())?.status === 'DONE');
    expect(sender.calls).toHaveLength(1);
  });

  it('429 then success through the real loops, one delivered message', async () => {
    const { application } = await pendingRequest();
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 1 }];
    start(sender);
    await approvals().approve(application.id, { adminId });
    await until(async () => (await prisma.outboxEvent.findFirst())?.status === 'DONE', 12_000);
    expect(sender.calls).toHaveLength(2); // one refused, one delivered
    expect(await prisma.notificationDelivery.findFirst()).toMatchObject({
      status: 'SENT',
      attempts: 2,
    });
  });

  it('a failed send changes neither the approval nor the role', async () => {
    const { user, application } = await pendingRequest();
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    start(sender);
    await approvals().approve(application.id, { adminId });
    await until(async () => (await prisma.outboxEvent.findFirst())?.status === 'FAILED');
    expect(
      await prisma.creatorApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).toMatchObject({ status: 'APPROVED' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      role: 'CREATOR',
    });
  });

  it('a user who blocked the bot is skipped, and sent again once the flag is cleared', async () => {
    const { user, application } = await pendingRequest();
    await prisma.user.update({ where: { id: user.id }, data: { botBlockedAt: new Date() } });
    const sender = new FakeSender();
    start(sender);
    await approvals().approve(application.id, { adminId });
    await until(async () => (await prisma.outboxEvent.findFirst())?.status === 'DONE');
    expect(sender.calls).toHaveLength(0);
    expect((await prisma.notificationDelivery.findFirst())?.status).toBe('SKIPPED');

    // After /start clears the flag, the next decision for that user is delivered.
    await prisma.user.update({ where: { id: user.id }, data: { botBlockedAt: null } });
    const second = await prisma.creatorApplication.create({
      data: {
        userId: user.id,
        creatorName: 'M2',
        instagramUrl: 'https://instagram.com/m2',
        creatorType: 'HUMAN',
        description: 'd',
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewReason: 'r',
      },
    });
    await prisma.outboxEvent.create({
      data: {
        type: 'creator_application.rejected',
        aggregateType: 'creator_application',
        aggregateId: second.id,
        payload: {},
        dedupeKey: `creator_application:${second.id}:decision`,
      },
    });
    await until(() => sender.calls.length === 1);
  });
});

describe('access activated pipeline (real PostgreSQL and Redis, fake Telegram)', () => {
  const access = () => new SubscriptionAccessService(prisma, new OutboxService());

  async function customerAndCreator() {
    const customer = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Raka Putra' },
    });
    const creatorUser = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
    });
    const creator = await prisma.creator.create({
      data: { userId: creatorUser.id, publicCode: 'aaaaaaab' },
    });
    return { customer, creator };
  }
  const ctx = () => ({ adminId, reason: 'Kompensasi gangguan layanan.', requestId: 'req-1' });

  it('an admin grant sends one Telegram message to the customer, with a button to the chat', async () => {
    const { customer, creator } = await customerAndCreator();
    const sender = new FakeSender();
    start(sender);
    const granted = await access().grant(
      customer.id,
      { creatorId: creator.id, durationDays: 30 },
      ctx(),
    );
    expect(granted.kind).toBe('ok');
    await until(() => sender.calls.length === 1);
    await until(
      async () =>
        (await prisma.outboxEvent.findFirst({ where: { type: 'subscription.granted' } }))
          ?.status === 'DONE',
    );
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    expect(sender.calls[0]).toMatchObject({
      chatId: customer.telegramId,
      message: {
        buttonText: 'Buka Aplikasi',
        url: `https://app.example.test/chats/${conversation.id}`,
      },
    });
    expect(sender.calls[0]?.message.text).toMatch(
      /^Halo Raka Putra, aksesmu ke Salsa Maheswari sudah aktif sampai /,
    );
    expect(
      await prisma.notificationDelivery.count({
        where: { status: 'SENT', kind: 'access_activated' },
      }),
    ).toBe(1);
  });

  it('delivers an event that waited while the worker was down, once it starts', async () => {
    const { customer, creator } = await customerAndCreator();
    await access().grant(customer.id, { creatorId: creator.id, durationDays: 30 }, ctx());
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.notificationDelivery.count()).toBe(0);
    const sender = new FakeSender();
    start(sender);
    await until(() => sender.calls.length === 1);
  });

  it('a failed send leaves the subscription active', async () => {
    const { customer, creator } = await customerAndCreator();
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    start(sender);
    await access().grant(customer.id, { creatorId: creator.id, durationDays: 30 }, ctx());
    await until(
      async () =>
        (await prisma.outboxEvent.findFirst({ where: { type: 'subscription.granted' } }))
          ?.status === 'FAILED',
    );
    const sub = await prisma.subscription.findFirstOrThrow();
    expect(sub.revokedAt).toBeNull();
    expect(sub.endsAt.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.notificationDelivery.findFirstOrThrow()).status).toBe('FAILED');
  });
});

describe('message notification pipeline (real PostgreSQL and Redis, fake Telegram)', () => {
  const DELAY = 500;
  const DAY = 86_400_000;

  async function chatPair() {
    const customer = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Raka Putra' },
    });
    const owner = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
    });
    const creator = await prisma.creator.create({
      data: { userId: owner.id, publicCode: 'hhhhhhhh' },
    });
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - 10 * DAY),
        endsAt: new Date(Date.now() + 10 * DAY),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, creatorId: creator.id },
    });
    return { customer, owner, conversation };
  }
  const sendFromCreator = (p: Awaited<ReturnType<typeof chatPair>>, body: string) =>
    new CreatorChatService(prisma, new OutboxService()).send(p.owner.id, p.conversation.id, {
      clientMessageId: randomUUID(),
      body,
    });
  const messageEvents = () => prisma.outboxEvent.findMany({ where: { type: 'message.created' } });

  it('tells the customer after the delay, once, and leaves the realtime signal alone', async () => {
    const p = await chatPair();
    const sender = new FakeSender();
    start(sender, { messageDelayMs: DELAY });
    const sent = await sendFromCreator(p, 'Rahasia-isi-pesan');
    expect(sent.kind).toBe('created');

    await new Promise((r) => setTimeout(r, DELAY / 3));
    expect(sender.calls).toHaveLength(0); // still inside the delay
    await until(() => sender.calls.length === 1);
    await until(async () => (await messageEvents())[0]?.status === 'DONE');
    await new Promise((r) => setTimeout(r, 300)); // room for a wrongful second send
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      chatId: p.customer.telegramId,
      message: {
        text: 'Pesan baru dari Salsa Maheswari.',
        url: `https://app.example.test/chats/${p.conversation.id}`,
      },
    });
    expect((await messageEvents())[0]?.realtimePublishedAt).toBeNull();
    expect(raw).not.toContain('Rahasia-isi-pesan');
  });

  it('does not tell a customer who read the chat during the delay', async () => {
    const p = await chatPair();
    const sender = new FakeSender();
    start(sender, { messageDelayMs: DELAY });
    const sent = await sendFromCreator(p, 'halo');
    if (sent.kind !== 'created') throw new Error(sent.kind);
    await prisma.conversationRead.create({
      data: {
        conversationId: p.conversation.id,
        userId: p.customer.id,
        lastReadSeq: sent.message.seq,
      },
    });
    await until(async () => (await messageEvents())[0]?.status === 'DONE');
    expect(sender.calls).toHaveLength(0);
    expect((await prisma.notificationDelivery.findFirstOrThrow()).lastErrorCode).toBe('read');
  });

  it('turns a burst into one notification', async () => {
    const p = await chatPair();
    const sender = new FakeSender();
    // All three messages must be written inside the delay; a long one keeps a loaded machine from splitting the burst.
    start(sender, { messageDelayMs: 1500 });
    for (const body of ['satu', 'dua', 'tiga']) await sendFromCreator(p, body);
    await until(async () => (await messageEvents()).every((e) => e.status === 'DONE'), 15_000);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.message.text).toBe('3 pesan baru dari Salsa Maheswari.');
    expect(await prisma.notificationDelivery.count()).toBe(3);
  });

  it('a failed notification never touches the message', async () => {
    const p = await chatPair();
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    start(sender, { messageDelayMs: DELAY });
    await sendFromCreator(p, 'tetap ada');
    await until(async () => (await messageEvents())[0]?.status === 'FAILED');
    expect(await prisma.message.findFirstOrThrow()).toMatchObject({ body: 'tetap ada' });
  });
});

describe('access reminder pipeline (real scheduler, PostgreSQL and Redis, fake Telegram)', () => {
  const DAY = 86_400_000;

  let codeNo = 0;
  async function subscription(endsInMs: number, over: { revoked?: boolean } = {}) {
    const customer = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Raka Putra' },
    });
    const owner = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
    });
    const creator = await prisma.creator.create({
      data: { userId: owner.id, publicCode: `lllllll${'abcdefgh'[codeNo++]}` },
    });
    const sub = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - 30 * DAY),
        endsAt: new Date(Date.now() + endsInMs),
        revokedAt: over.revoked ? new Date() : null,
      },
    });
    return { customer, sub };
  }
  const noticeEvents = () =>
    prisma.outboxEvent.findMany({
      where: { type: { in: ['subscription.reminder_due', 'subscription.ended'] } },
    });

  it('reminds a customer whose access ends soon, once, however long the scheduler keeps running', async () => {
    const { customer } = await subscription(2 * DAY);
    const sender = new FakeSender();
    start(sender, { schedulerIntervalMs: 100 });
    await until(() => sender.calls.length === 1);
    await until(async () => (await noticeEvents()).every((e) => e.status === 'DONE'));
    await new Promise((r) => setTimeout(r, 500)); // room for a wrongful second notice
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      chatId: customer.telegramId,
      message: { buttonText: 'Buka Aplikasi', url: 'https://app.example.test/subscriptions' },
    });
    expect(sender.calls[0]?.message.text).toMatch(
      /^Halo Raka Putra, aksesmu ke Salsa Maheswari berakhir \d+ \w+ 20\d\d, \d\d\.\d\d WIB\. Hubungi admin/,
    );
    expect(await noticeEvents()).toHaveLength(1);
  });

  it('sends nothing twice across a worker restart', async () => {
    await subscription(2 * DAY);
    const sender = new FakeSender();
    const first = start(sender, { schedulerIntervalMs: 100 });
    await until(() => sender.calls.length === 1);
    await until(async () => (await noticeEvents()).every((e) => e.status === 'DONE'));
    await first?.stop();
    running = null;
    start(sender, { schedulerIntervalMs: 100 });
    await new Promise((r) => setTimeout(r, 600));
    expect(sender.calls).toHaveLength(1);
    expect(await noticeEvents()).toHaveLength(1);
  });

  it('tells a customer whose access has just ended, and never reminds them afterwards', async () => {
    await subscription(-60 * 60_000);
    const sender = new FakeSender();
    start(sender, { schedulerIntervalMs: 100 });
    await until(() => sender.calls.length === 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.message.text).toBe(
      'Halo Raka Putra, aksesmu ke Salsa Maheswari sudah berakhir. Terima kasih sudah bergabung.',
    );
    expect((await noticeEvents()).map((e) => e.type)).toEqual(['subscription.ended']);
  });

  it('says nothing about a revoked access or one that is far from its end', async () => {
    await subscription(2 * DAY, { revoked: true });
    await subscription(20 * DAY);
    const sender = new FakeSender();
    start(sender, { schedulerIntervalMs: 100 });
    await new Promise((r) => setTimeout(r, 600));
    expect(sender.calls).toHaveLength(0);
    expect(await noticeEvents()).toHaveLength(0);
  });

  it('a failed notice never touches the access', async () => {
    const { sub } = await subscription(2 * DAY);
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    start(sender, { schedulerIntervalMs: 100 });
    await until(async () => (await noticeEvents())[0]?.status === 'FAILED');
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.revokedAt).toBeNull();
    expect(after.endsAt).toEqual(sub.endsAt);
  });
});

describe('startNotifications configuration', () => {
  it('registers nothing and warns once while the bot or Mini App URL is missing', () => {
    for (const partial of [
      { ...env, TELEGRAM_BOT_TOKEN: undefined },
      { ...env, MINIAPP_URL: undefined },
    ]) {
      raw = '';
      expect(startNotifications({ env: partial, prisma, logger, queuePrefix: prefix })).toBeNull();
      const lines = raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe(40);
    }
  });

  it('starts and stops cleanly, and the token never reaches the logs', async () => {
    const started = startNotifications({
      env,
      prisma,
      logger,
      queuePrefix: prefix,
      intervalMs: 50,
    });
    expect(started).not.toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    await started?.stop();
    expect(raw).not.toContain('SECRET');
  });
});
