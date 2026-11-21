import { Writable } from 'node:stream';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runLockedScan, startAccessScheduler } from './access-scheduler.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;

let raw = '';
const logger = pino(
  { level: 'info' },
  new Writable({ write: (c, _e, cb) => ((raw += String(c)), cb()) }),
);
const lines = () =>
  raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

beforeEach(async () => {
  raw = '';
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

async function subscriptionEnding(inMs: number) {
  const customer = await prisma.user.create({
    data: { telegramId: BigInt(Date.now()), displayName: 'R' },
  });
  const owner = await prisma.user.create({
    data: { telegramId: BigInt(Date.now()) + 1n, displayName: 'S', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'kkkkkkkk' },
  });
  return prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(Date.now() - 30 * DAY),
      endsAt: new Date(Date.now() + inMs),
    },
  });
}

describe('runLockedScan', () => {
  it('scans and returns the counts when nobody else is scanning', async () => {
    await subscriptionEnding(2 * DAY);
    const result = await runLockedScan(prisma, {
      scan: async () => ({ reminders: 1, ended: 0 }),
    });
    expect(result).toEqual({ reminders: 1, ended: 0 });
  });

  it('does nothing while another worker holds the scan lock, and scans again once it is released', async () => {
    let scans = 0;
    const service = {
      scan: async () => {
        scans += 1;
        return { reminders: 0, ended: 0 };
      },
    };
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const other = prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(4507001::bigint) AS locked`;
      expect(row?.locked).toBe(true);
      await held;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(await runLockedScan(prisma, service)).toBe('locked');
    expect(scans).toBe(0);
    release();
    await other;
    expect(await runLockedScan(prisma, service)).toEqual({ reminders: 0, ended: 0 });
    expect(scans).toBe(1);
  });

  it('the lock is gone after an error, so the next scan can run', async () => {
    await expect(
      runLockedScan(prisma, {
        scan: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(await runLockedScan(prisma, { scan: async () => ({ reminders: 0, ended: 0 }) })).toEqual(
      {
        reminders: 0,
        ended: 0,
      },
    );
  });
});

describe('startAccessScheduler', () => {
  it('writes the reminder and the ended notice for real subscriptions, once, however often it scans', async () => {
    const soon = await subscriptionEnding(2 * DAY);
    const scheduler = startAccessScheduler({ prisma, logger, leadDays: 3, intervalMs: 50 });
    await new Promise((r) => setTimeout(r, 400));
    await scheduler.stop();
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: soon.id } });
    expect(events.map((e) => e.type)).toEqual(['subscription.reminder_due']);
    expect(lines().some((l) => l.reminders === 1)).toBe(true);
  });

  it('survives a failing scan, logs it once, and logs the recovery', async () => {
    let calls = 0;
    const flaky = {
      $transaction: async () => {
        calls += 1;
        if (calls <= 3) throw new Error('postgres://user:secret@host/db');
        return { reminders: 0, ended: 0 };
      },
    } as unknown as PrismaClient;
    const scheduler = startAccessScheduler({ prisma: flaky, logger, leadDays: 3, intervalMs: 30 });
    await new Promise((r) => setTimeout(r, 400));
    await scheduler.stop();
    expect(calls).toBeGreaterThan(4);
    const failures = lines().filter((l) => l.msg === 'access scheduler failing');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toBe('Error');
    expect(lines().some((l) => l.msg === 'access scheduler recovered')).toBe(true);
    expect(raw).not.toContain('secret');
  });

  it('never runs two scans at once in one process, and stop waits for the running one', async () => {
    let active = 0;
    let peak = 0;
    const slow = {
      $transaction: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 120));
        active -= 1;
        return 'locked';
      },
    } as unknown as PrismaClient;
    const scheduler = startAccessScheduler({ prisma: slow, logger, leadDays: 3, intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 300));
    await scheduler.stop();
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });
});
