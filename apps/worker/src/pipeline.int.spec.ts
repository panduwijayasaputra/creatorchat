import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  AccountSecurityService,
  CreatorApprovalService,
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
