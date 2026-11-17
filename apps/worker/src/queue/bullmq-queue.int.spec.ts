import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadRootEnv } from '@creatorchat/db/testing';
import { createNotificationQueue, createNotificationWorker } from './bullmq-queue.js';

loadRootEnv();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prefix = `test:bull:${randomUUID()}`;
const logger = pino({ level: 'silent' });
const closers: (() => Promise<void>)[] = [];

const until = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});
afterAll(async () => {
  const redis = new Redis(redisUrl);
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

function start(handler: (eventId: string) => Promise<string>) {
  const queue = createNotificationQueue({ redisUrl, prefix });
  const worker = createNotificationWorker({ redisUrl, prefix, logger, handler });
  closers.push(
    () => worker.close(),
    () => queue.close(),
  );
  return queue;
}

describe('BullMQ notification queue', () => {
  it('runs a job once, with the event id', async () => {
    const seen: string[] = [];
    const queue = start(async (id) => (seen.push(id), 'sent'));
    await queue.add({
      jobId: 'evt-1',
      name: 'creator_application.approved',
      data: { eventId: 'evt-1' },
    });
    await until(() => seen.length === 1);
    expect(seen).toEqual(['evt-1']);
  });

  it('runs the same job id once even when it is added twice', async () => {
    const seen: string[] = [];
    const queue = start(async (id) => {
      seen.push(id);
      await new Promise((r) => setTimeout(r, 100));
      return 'sent';
    });
    const job = {
      jobId: 'evt-2',
      name: 'creator_application.approved',
      data: { eventId: 'evt-2' },
    };
    await queue.add(job);
    await queue.add(job);
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual(['evt-2']);
  });

  it('accepts the same job id again once the first run has completed (a retry)', async () => {
    const seen: string[] = [];
    const queue = start(async (id) => (seen.push(id), 'retry'));
    const job = {
      jobId: 'evt-r',
      name: 'creator_application.approved',
      data: { eventId: 'evt-r' },
    };
    await queue.add(job);
    await until(() => seen.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    await queue.add(job);
    await until(() => seen.length === 2);
  });

  it('does not retry-loop when the handler throws (the job still completes)', async () => {
    let calls = 0;
    const queue = start(async () => {
      calls += 1;
      throw new TypeError('boom redis://secret@host');
    });
    await queue.add({
      jobId: 'evt-3',
      name: 'creator_application.approved',
      data: { eventId: 'evt-3' },
    });
    await until(() => calls >= 1);
    await new Promise((r) => setTimeout(r, 800));
    expect(calls).toBe(1);
  });

  it('closes cleanly', async () => {
    const queue = start(async () => 'sent');
    await queue.add({ jobId: 'evt-4', name: 'x', data: { eventId: 'evt-4' } });
    await expect(Promise.all(closers.splice(0).map((c) => c()))).resolves.toBeDefined();
    expect(queue).toBeDefined();
  });
});
