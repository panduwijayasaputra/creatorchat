import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  OutboxService,
  SubscriptionAccessService,
  type WelcomeDeliveryService,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startWelcome, type Welcome } from './welcome.js';
import { WELCOME_MAX_ATTEMPTS, WelcomeEventHandler } from './welcome-events.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prefix = `test:bull:${randomUUID()}`;
const SECRET_TEXT = 'Teks-rahasia-sambutan';

let raw = '';
const logger = pino(
  { level: 'info' },
  new Writable({ write: (c, _e, cb) => ((raw += String(c)), cb()) }),
);
let running: Welcome | null = null;
let n = 88_000n;
let adminId = '';

const start = () => {
  running = startWelcome({
    env: { REDIS_URL: redisUrl },
    prisma,
    logger,
    queuePrefix: prefix,
    intervalMs: 50,
    reconcileMs: 200,
  });
  return running;
};
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) {
      throw new Error(
        'timed out: ' +
          raw.slice(-1200) +
          JSON.stringify(
            await prisma.outboxEvent.findMany({
              select: { type: true, status: true, lastError: true },
            }),
          ),
      );
    }
    await new Promise((r) => setTimeout(r, 40));
  }
};

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
afterAll(() => prisma.$disconnect());

async function welcomeConfig(over: { enabled?: boolean } = {}) {
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'nnnnnnnn' },
  });
  await prisma.creatorWelcomeMessage.create({
    data: { creatorId: creator.id, enabled: over.enabled ?? true, body: SECRET_TEXT },
  });
  return { owner, creator };
}

const grant = async (creatorId: string) => {
  const customer = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka Putra' },
  });
  const r = await new SubscriptionAccessService(prisma, new OutboxService()).grant(
    customer.id,
    { creatorId, durationDays: 30 },
    { adminId, reason: 'Uji coba.', requestId: 'req-1' },
  );
  if (r.kind !== 'ok') throw new Error(r.kind);
  return { customer, subscription: r.subscription };
};
const welcomeEvents = () => prisma.outboxEvent.findMany({ where: { type: 'welcome.requested' } });
const eventRow = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

describe('welcome pipeline (real PostgreSQL and Redis)', () => {
  it("writes the welcome message into the new subscriber's chat after the first grant, once, and settles the event", async () => {
    const c = await welcomeConfig();
    const g = await grant(c.creator.id);
    start();
    await until(async () => (await welcomeEvents())[0]?.status === 'DONE');
    await new Promise((r) => setTimeout(r, 300)); // room for a wrongful second message
    const messages = await prisma.message.findMany();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      senderUserId: c.owner.id,
      body: SECRET_TEXT,
      origin: 'MANUAL',
    });
    expect((await prisma.conversation.findFirstOrThrow()).customerId).toBe(g.customer.id);
    expect(await prisma.welcomeDelivery.count()).toBe(1);
    // announced like any message
    expect(await prisma.outboxEvent.count({ where: { type: 'message.created' } })).toBe(1);
  });

  it('delivers a welcome that waited while the worker was down, once it starts', async () => {
    const c = await welcomeConfig();
    await grant(c.creator.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.message.count()).toBe(0);
    start();
    await until(async () => (await welcomeEvents())[0]?.status === 'DONE');
    expect(await prisma.message.count()).toBe(1);
  });

  it('after the loops were killed and restarted there is still one message', async () => {
    const c = await welcomeConfig();
    await grant(c.creator.id);
    const first = start();
    await until(async () => (await prisma.message.count()) > 0);
    await first.stop();
    running = null;
    await prisma.outboxEvent.updateMany({
      where: { type: 'welcome.requested', status: 'ENQUEUED' },
      data: { status: 'PENDING' },
    });
    start();
    await until(async () => (await welcomeEvents())[0]?.status === 'DONE');
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.welcomeDelivery.count()).toBe(1);
  });

  it('with the switch off the event is closed as skipped, and switching it on later sends nothing', async () => {
    const c = await welcomeConfig({ enabled: false });
    await grant(c.creator.id);
    start();
    await until(async () => (await welcomeEvents())[0]?.status === 'DONE');
    expect((await welcomeEvents())[0]?.lastError).toBe('disabled');
    expect(await prisma.message.count()).toBe(0);
    await prisma.creatorWelcomeMessage.update({
      where: { creatorId: c.creator.id },
      data: { enabled: true },
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.welcomeDelivery.count()).toBe(0);
  });

  it('a later extension or re-grant does not send it again', async () => {
    const c = await welcomeConfig();
    const g = await grant(c.creator.id);
    start();
    await until(async () => (await welcomeEvents())[0]?.status === 'DONE');
    await new SubscriptionAccessService(prisma, new OutboxService()).extend(
      g.customer.id,
      g.subscription.id,
      { durationDays: 10 },
      { adminId, reason: 'Perpanjang.', requestId: 'req-2' },
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(await welcomeEvents()).toHaveLength(1);
    expect(await prisma.message.count()).toBe(1);
  });

  it('never writes the welcome text into the logs', async () => {
    const c = await welcomeConfig();
    await grant(c.creator.id);
    start();
    await until(async () => (await welcomeEvents())[0]?.status === 'DONE');
    expect(raw).not.toContain(SECRET_TEXT);
  });
});

describe('WelcomeEventHandler', () => {
  const T0 = new Date('2026-11-21T10:00:00.000Z');
  const serviceFor = (
    result: Awaited<ReturnType<WelcomeDeliveryService['deliver']>> | Error,
  ): WelcomeDeliveryService & { calls: number } => {
    const stub = {
      calls: 0,
      async deliver() {
        stub.calls += 1;
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return stub as unknown as WelcomeDeliveryService & { calls: number };
  };
  const handler = (s: WelcomeDeliveryService) => new WelcomeEventHandler(prisma, s, () => T0);
  const pendingEvent = (attempts = 0) =>
    prisma.outboxEvent.create({
      data: {
        type: 'welcome.requested',
        aggregateType: 'subscription',
        aggregateId: randomUUID(),
        payload: {},
        dedupeKey: `welcome:${randomUUID()}`,
        status: 'ENQUEUED',
        attempts,
      },
    });

  it('delivered and duplicate close the event; skipped keeps its reason as a short code', async () => {
    for (const [result, lastError] of [
      [{ kind: 'delivered' }, null],
      [{ kind: 'duplicate' }, null],
      [{ kind: 'skipped', reason: 'access_ended' }, 'access_ended'],
    ] as const) {
      const e = await pendingEvent();
      await handler(serviceFor(result)).process(e.id);
      expect(await eventRow(e.id)).toMatchObject({ status: 'DONE', lastError });
    }
  });

  it('a subscription that is gone fails the event', async () => {
    const e = await pendingEvent();
    expect(await handler(serviceFor({ kind: 'missing' })).process(e.id)).toBe('missing');
    expect(await eventRow(e.id)).toMatchObject({ status: 'FAILED', lastError: 'welcome_missing' });
  });

  it('an unexpected error backs off and counts, and the last attempt gives up with a safe code', async () => {
    const e = await pendingEvent();
    const boom = serviceFor(new Error('postgres://user:secret@host/db'));
    expect(await handler(boom).process(e.id)).toBe('retry');
    const retried = await eventRow(e.id);
    expect(retried).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'welcome_error' });
    expect(retried.availableAt.getTime()).toBeGreaterThan(T0.getTime());
    const last = await pendingEvent(WELCOME_MAX_ATTEMPTS - 1);
    expect(await handler(boom).process(last.id)).toBe('failed');
    expect(await eventRow(last.id)).toMatchObject({ status: 'FAILED', lastError: 'welcome_error' });
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain('secret');
  });

  it('a settled event is not worked again, and an unknown id is missing', async () => {
    const e = await pendingEvent();
    const s = serviceFor({ kind: 'delivered' });
    await handler(s).process(e.id);
    expect(await handler(s).process(e.id)).toBe('duplicate');
    expect(s.calls).toBe(1);
    expect(await handler(s).process(randomUUID())).toBe('missing');
  });
});
