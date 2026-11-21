import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  BroadcastService,
  OutboxService,
  type BroadcastProcessor,
  type BroadcastRunResult,
} from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROADCAST_MAX_ATTEMPTS, BroadcastEventHandler } from './broadcast-events.js';
import { startBroadcast, type Broadcast } from './broadcast.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prefix = `test:bull:${randomUUID()}`;
const DAY = 86_400_000;
const SECRET_TEXT = 'Teks-rahasia-broadcast';

let raw = '';
const logger = pino(
  { level: 'info' },
  new Writable({ write: (c, _e, cb) => ((raw += String(c)), cb()) }),
);
let running: Broadcast | null = null;
let n = 72_000n;

const start = () => {
  running = startBroadcast({
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
});
afterEach(async () => {
  await running?.stop();
  running = null;
});
afterAll(() => prisma.$disconnect());

async function recordBroadcast(active = 3) {
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'ffffffff' },
  });
  const customers = [];
  for (let i = 0; i < active + 1; i++) {
    const user = await prisma.user.create({ data: { telegramId: n++, displayName: `C${i}` } });
    await prisma.subscription.create({
      data: {
        customerId: user.id,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - 30 * DAY),
        // the last customer's access has ended
        endsAt: new Date(Date.now() + (i < active ? 10 : -1) * DAY),
      },
    });
    await prisma.conversation.create({ data: { customerId: user.id, creatorId: creator.id } });
    customers.push(user);
  }
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
  const r = await new BroadcastService(prisma, new OutboxService()).create(owner.id, {
    clientBroadcastId: randomUUID(),
    assetId,
    body: SECRET_TEXT,
    saveToGallery: false,
  });
  if (r.kind !== 'created') throw new Error(r.kind);
  const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'broadcast.created' } });
  return { owner, creator, customers, broadcast: r.broadcast, event };
}

const eventRow = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

describe('broadcast pipeline (real PostgreSQL and Redis)', () => {
  it('delivers one message per active subscriber through the loops and settles the event', async () => {
    const s = await recordBroadcast(3);
    start();
    await until(async () => (await eventRow(s.event.id)).status === 'DONE');
    expect(await prisma.message.count({ where: { broadcastId: s.broadcast.id } })).toBe(3);
    expect(await prisma.messageAttachment.count()).toBe(3);
    const done = await prisma.broadcast.findUniqueOrThrow({ where: { id: s.broadcast.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', recipientCount: 3 });
    const expired = s.customers[3]!;
    expect(
      await prisma.message.count({ where: { conversation: { customerId: expired.id } } }),
    ).toBe(0);
    // each message is announced like any other (realtime, notifications)
    expect(await prisma.outboxEvent.count({ where: { type: 'message.created' } })).toBe(3);
  });

  it('delivers a broadcast that waited while the worker was down, once it starts', async () => {
    const s = await recordBroadcast(2);
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.message.count()).toBe(0);
    start();
    await until(async () => (await eventRow(s.event.id)).status === 'DONE');
    expect(await prisma.message.count()).toBe(2);
  });

  it('after the loops were killed and restarted, still exactly one message each', async () => {
    const s = await recordBroadcast(3);
    const first = start();
    await until(async () => (await prisma.message.count()) > 0);
    await first.stop();
    running = null;
    // the event may have been left ENQUEUED by the kill: the reconciler puts it back
    await prisma.outboxEvent.updateMany({
      where: { id: s.event.id, status: 'ENQUEUED' },
      data: { status: 'PENDING' },
    });
    start();
    await until(async () => (await eventRow(s.event.id)).status === 'DONE');
    expect(await prisma.message.count()).toBe(3);
    expect(new Set((await prisma.message.findMany()).map((m) => m.conversationId)).size).toBe(3);
  });

  it('never writes the text or a storage key into the logs', async () => {
    const s = await recordBroadcast(1);
    start();
    await until(async () => (await eventRow(s.event.id)).status === 'DONE');
    expect(raw).not.toContain(SECRET_TEXT);
    expect(raw).not.toMatch(/object_key|thumb_key|m\//);
  });
});

describe('BroadcastEventHandler', () => {
  const T0 = new Date('2026-11-21T10:00:00.000Z');
  const processorFor = (
    result: BroadcastRunResult | Error,
  ): BroadcastProcessor & { calls: number } => {
    const stub = {
      calls: 0,
      async run() {
        stub.calls += 1;
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return stub as unknown as BroadcastProcessor & { calls: number };
  };
  const handler = (p: BroadcastProcessor) =>
    new BroadcastEventHandler(prisma, p, { clock: () => T0, budgetMs: 10 });
  async function pendingEvent(attempts = 0) {
    return prisma.outboxEvent.create({
      data: {
        type: 'broadcast.created',
        aggregateType: 'broadcast',
        aggregateId: randomUUID(),
        payload: {},
        dedupeKey: `broadcast:${randomUUID()}:created`,
        status: 'ENQUEUED',
        attempts,
      },
    });
  }

  it('done closes the event', async () => {
    const e = await pendingEvent();
    expect(await handler(processorFor('done')).process(e.id)).toBe('done');
    expect(await eventRow(e.id)).toMatchObject({ status: 'DONE', lastError: null, attempts: 1 });
  });

  it('continue puts the event straight back without counting an attempt', async () => {
    const e = await pendingEvent(2);
    expect(await handler(processorFor('continue')).process(e.id)).toBe('continue');
    const after = await eventRow(e.id);
    expect(after).toMatchObject({ status: 'PENDING', attempts: 2 });
    expect(after.availableAt).toEqual(T0);
  });

  it('a broadcast that is gone fails the event', async () => {
    const e = await pendingEvent();
    await handler(processorFor('missing')).process(e.id);
    expect(await eventRow(e.id)).toMatchObject({
      status: 'FAILED',
      lastError: 'broadcast_missing',
    });
  });

  it('an unexpected error backs off and counts, and the last attempt gives up with a safe code', async () => {
    const e = await pendingEvent();
    const boom = processorFor(new Error('postgres://user:secret@host/db'));
    expect(await handler(boom).process(e.id)).toBe('retry');
    const retried = await eventRow(e.id);
    expect(retried).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'fanout_error' });
    expect(retried.availableAt.getTime()).toBeGreaterThan(T0.getTime());

    const last = await pendingEvent(BROADCAST_MAX_ATTEMPTS - 1);
    expect(await handler(boom).process(last.id)).toBe('failed');
    expect(await eventRow(last.id)).toMatchObject({ status: 'FAILED', lastError: 'fanout_error' });
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain('secret');
  });

  it('a settled event is not worked again, and an unknown id is missing', async () => {
    const e = await pendingEvent();
    const p = processorFor('done');
    await handler(p).process(e.id);
    expect(await handler(p).process(e.id)).toBe('duplicate');
    expect(p.calls).toBe(1);
    expect(await handler(p).process(randomUUID())).toBe('missing');
  });
});
