import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobQueue } from './job-queue.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const TYPE = 'creator_application.approved';
const T0 = new Date('2026-11-16T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

class MemoryQueue implements JobQueue {
  jobs: { jobId: string; name: string }[] = [];
  fail = false;
  async add(job: { jobId: string; name: string }) {
    if (this.fail) throw new Error('redis down: redis://secret@host');
    if (!this.jobs.some((j) => j.jobId === job.jobId)) this.jobs.push(job);
  }
}

async function event(over: Record<string, unknown> = {}) {
  return prisma.outboxEvent.create({
    data: {
      type: TYPE,
      aggregateType: 'creator_application',
      aggregateId: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
      payload: {},
      dedupeKey: `k-${Math.random()}`,
      availableAt: at(-1000),
      ...over,
    },
  });
}

async function delivery(eventId: string, over: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { telegramId: BigInt(Math.floor(Math.random() * 1e9)), displayName: 'U' },
  });
  return prisma.notificationDelivery.create({
    data: {
      dedupeKey: `d-${Math.random()}`,
      outboxEventId: eventId,
      userId: user.id,
      kind: 'creator_result',
      ...over,
    } as never,
  });
}

const make = (queue: JobQueue, now = T0, types: string[] = [TYPE]) =>
  new OutboxDispatcher(prisma, queue, { handledTypes: types, clock: () => now });

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('OutboxDispatcher.dispatch', () => {
  it('enqueues a committed PENDING event once, with job id = event id, and marks it ENQUEUED', async () => {
    const e = await event();
    const queue = new MemoryQueue();
    const d = make(queue);
    expect(await d.dispatch()).toEqual({ enqueued: 1, failed: 0 });
    expect(queue.jobs).toEqual([{ jobId: e.id, name: TYPE, data: { eventId: e.id } }]);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('ENQUEUED');
    expect(row.enqueuedAt?.toISOString()).toBe(T0.toISOString());
    expect(await d.dispatch()).toEqual({ enqueued: 0, failed: 0 });
    expect(queue.jobs).toHaveLength(1);
  });

  it('leaves future, unhandled and finished events alone', async () => {
    await event({ availableAt: at(60_000) });
    await event({ type: 'something.else' });
    await event({ status: 'DONE' });
    await event({ status: 'FAILED' });
    const queue = new MemoryQueue();
    expect(await make(queue).dispatch()).toEqual({ enqueued: 0, failed: 0 });
    expect(queue.jobs).toEqual([]);
    expect(await make(queue, at(61_000)).dispatch()).toMatchObject({ enqueued: 1 });
  });

  it('claims nothing when no types are handled', async () => {
    await event();
    expect(await make(new MemoryQueue(), T0, []).dispatch()).toEqual({ enqueued: 0, failed: 0 });
  });

  it('lets two dispatchers race without enqueueing an event twice', async () => {
    for (let i = 0; i < 12; i += 1) await event();
    const queue = new MemoryQueue();
    const counts: string[] = [];
    const counting: JobQueue = {
      add: async (job) => {
        counts.push(job.jobId);
        await new Promise((r) => setTimeout(r, 5));
        await queue.add(job);
      },
    };
    const [a, b] = await Promise.all([make(counting).dispatch(), make(counting).dispatch()]);
    expect(a.enqueued + b.enqueued).toBe(12);
    expect(new Set(counts).size).toBe(12);
    expect(counts).toHaveLength(12);
  });

  it('leaves the row PENDING when the queue fails, without keeping the error text', async () => {
    const e = await event();
    const queue = new MemoryQueue();
    queue.fail = true;
    expect(await make(queue).dispatch()).toEqual({ enqueued: 0, failed: 1 });
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ status: 'PENDING', enqueuedAt: null, lastError: null });
    queue.fail = false;
    expect(await make(queue).dispatch()).toMatchObject({ enqueued: 1 });
  });

  it('respects the batch size', async () => {
    for (let i = 0; i < 5; i += 1) await event();
    const d = new OutboxDispatcher(prisma, new MemoryQueue(), {
      handledTypes: [TYPE],
      batchSize: 2,
      clock: () => T0,
    });
    expect(await d.dispatch()).toMatchObject({ enqueued: 2 });
  });
});

describe('OutboxDispatcher.dispatch with a minimum age', () => {
  const make2 = (queue: JobQueue, now: Date, minAgeMs: Record<string, number>) =>
    new OutboxDispatcher(prisma, queue, {
      handledTypes: [TYPE, 'message.created'],
      minAgeMs,
      clock: () => now,
    });

  it('claims a delayed type only once it is old enough, and never delays the other types', async () => {
    const young = await event({ type: 'message.created', createdAt: at(-10_000) });
    const old = await event({ type: 'message.created', createdAt: at(-40_000) });
    const other = await event({ createdAt: at(-1000) });
    const queue = new MemoryQueue();
    const result = await make2(queue, T0, { 'message.created': 30_000 }).dispatch();
    expect(result.enqueued).toBe(2);
    expect(queue.jobs.map((j) => j.jobId).sort()).toEqual([old.id, other.id].sort());
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: young.id } })).status).toBe(
      'PENDING',
    );
    // later the young one is old enough
    const later = new MemoryQueue();
    await make2(later, at(25_000), { 'message.created': 30_000 }).dispatch();
    expect(later.jobs.map((j) => j.jobId)).toEqual([young.id]);
  });

  it('an age for a type that is not handled is ignored, and no age means no delay', async () => {
    const fresh = await event({ type: 'message.created', createdAt: at(-1) });
    const queue = new MemoryQueue();
    await make2(queue, T0, { 'something.else': 60_000 }).dispatch();
    expect(queue.jobs.map((j) => j.jobId)).toEqual([fresh.id]);
  });
});

describe('OutboxDispatcher.reconcile', () => {
  it('puts a stale ENQUEUED event back, and enqueues it again (crash with no job)', async () => {
    const e = await event({ status: 'ENQUEUED', enqueuedAt: at(-5 * 60_000) });
    const queue = new MemoryQueue();
    const d = make(queue);
    expect(await d.reconcile()).toEqual({ requeued: 1, ambiguous: 0 });
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).status).toBe(
      'PENDING',
    );
    await d.dispatch();
    expect(queue.jobs.map((j) => j.jobId)).toEqual([e.id]);
  });

  it('leaves a fresh ENQUEUED event, and DONE / FAILED / unhandled ones, alone', async () => {
    await event({ status: 'ENQUEUED', enqueuedAt: at(-30_000) });
    await event({ status: 'DONE', enqueuedAt: at(-9e6) });
    await event({ status: 'FAILED', enqueuedAt: at(-9e6) });
    await event({ type: 'other', status: 'ENQUEUED', enqueuedAt: at(-9e6) });
    expect(await make(new MemoryQueue()).reconcile()).toEqual({ requeued: 0, ambiguous: 0 });
  });

  it('turns a stale SENDING delivery into an ambiguous retry with a backoff', async () => {
    const e = await event({ status: 'ENQUEUED', enqueuedAt: at(-60_000) });
    const dl = await delivery(e.id, {
      status: 'SENDING',
      attempts: 1,
      claimedAt: at(-5 * 60_000),
    });
    expect(await make(new MemoryQueue()).reconcile()).toMatchObject({ ambiguous: 1 });
    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dl.id } });
    expect(row).toMatchObject({
      status: 'PENDING',
      ambiguousAttempts: 1,
      claimedAt: null,
      lastErrorCode: 'interrupted',
    });
    const ev = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } });
    expect(ev.status).toBe('PENDING');
    expect(ev.availableAt.toISOString()).toBe(at(5_000).toISOString());
  });

  it('does not touch a recent SENDING delivery or a finished one', async () => {
    const e1 = await event({ status: 'ENQUEUED', enqueuedAt: at(-1000) });
    const live = await delivery(e1.id, { status: 'SENDING', attempts: 1, claimedAt: at(-10_000) });
    const e2 = await event({ status: 'DONE' });
    const sent = await delivery(e2.id, { status: 'SENT', attempts: 1 });
    expect(await make(new MemoryQueue()).reconcile()).toEqual({ requeued: 0, ambiguous: 0 });
    expect(
      (await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: live.id } })).status,
    ).toBe('SENDING');
    expect(
      (await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: sent.id } })).status,
    ).toBe('SENT');
  });

  it('fails a stale SENDING delivery that is out of attempts instead of looping', async () => {
    const e = await event({ status: 'ENQUEUED', enqueuedAt: at(-60_000) });
    const dl = await delivery(e.id, { status: 'SENDING', attempts: 10, claimedAt: at(-9e5) });
    await make(new MemoryQueue()).reconcile();
    expect(
      (await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: dl.id } })).status,
    ).toBe('FAILED');
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      status: 'FAILED',
      lastError: 'max_attempts',
    });
  });
});
