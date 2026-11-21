import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { AccessScheduleService } from './access-schedule.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date('2026-11-21T05:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const schedule = (leadDays = 3, batchSize?: number) =>
  new AccessScheduleService(prisma, new OutboxService(), {
    leadDays,
    clock: () => NOW,
    ...(batchSize ? { batchSize } : {}),
  });

let n = 80_000n;
let codeNo = 0;
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

async function creator(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: { userId: user.id, publicCode: `sssssss${'abcdefgh'[codeNo++]}`, status },
  });
}

async function sub(
  creatorId: string,
  over: { endsIn: number; revoked?: boolean; customer?: Record<string, unknown> } = { endsIn: 0 },
) {
  const customer = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka', ...over.customer },
  });
  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId,
      startsAt: at(-40 * DAY),
      endsAt: at(over.endsIn),
      revokedAt: over.revoked ? at(-DAY) : null,
    },
  });
  return { customer, subscription };
}

const events = (type: string) =>
  prisma.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });

describe('reminders', () => {
  it('writes one for an active subscription ending within the lead time, and none for later ends', async () => {
    const c = await creator();
    const soon = await sub(c.id, { endsIn: 2 * DAY });
    await sub(c.id, { endsIn: 5 * DAY });
    expect(await schedule().scan()).toEqual({ reminders: 1, ended: 0 });
    const [e] = await events('subscription.reminder_due');
    expect(e).toMatchObject({
      aggregateType: 'subscription',
      aggregateId: soon.subscription.id,
      status: 'PENDING',
      payload: {
        subscription_id: soon.subscription.id,
        customer_id: soon.customer.id,
        creator_id: c.id,
        ends_at: at(2 * DAY).toISOString(),
      },
    });
    expect(e?.dedupeKey).toBe(
      `subscription:${soon.subscription.id}:ends:${at(2 * DAY).getTime()}:reminder`,
    );
  });

  it('scanning again, or at the next tick, writes nothing new', async () => {
    const c = await creator();
    await sub(c.id, { endsIn: 2 * DAY });
    await schedule().scan();
    expect(await schedule().scan()).toEqual({ reminders: 0, ended: 0 });
    expect(await schedule().scan(at(HOUR))).toEqual({ reminders: 0, ended: 0 });
    expect(await events('subscription.reminder_due')).toHaveLength(1);
  });

  it('an extension is a new period with its own reminder', async () => {
    const c = await creator();
    const { subscription } = await sub(c.id, { endsIn: 2 * DAY });
    await schedule().scan();
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { endsAt: at(20 * DAY) },
    });
    expect(await schedule().scan()).toEqual({ reminders: 0, ended: 0 });
    // 18 days later the new end is two days away
    expect(await schedule().scan(at(18 * DAY))).toEqual({ reminders: 1, ended: 0 });
    const keys = (await events('subscription.reminder_due')).map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('never for an access that already ended, a revoked one, or accounts that are blocked', async () => {
    const c = await creator();
    await sub(c.id, { endsIn: -HOUR }); // ended: only an ended notice
    await sub(c.id, { endsIn: 2 * DAY, revoked: true });
    await sub(c.id, { endsIn: 2 * DAY, customer: { status: 'BLOCKED' } });
    const blocked = await creator('BLOCKED');
    await sub(blocked.id, { endsIn: 2 * DAY });
    const result = await schedule().scan();
    expect(result.reminders).toBe(0);
    expect(await events('subscription.reminder_due')).toHaveLength(0);
  });

  it('the lead time is the configured one', async () => {
    const c = await creator();
    await sub(c.id, { endsIn: 5 * DAY });
    expect((await schedule(3).scan()).reminders).toBe(0);
    expect((await schedule(7).scan()).reminders).toBe(1);
  });

  it('a subscription that has not started is not reminded', async () => {
    const c = await creator();
    const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'R' } });
    await prisma.subscription.create({
      data: { customerId: customer.id, creatorId: c.id, startsAt: at(DAY), endsAt: at(2 * DAY) },
    });
    expect((await schedule().scan()).reminders).toBe(0);
  });
});

describe('ended notices', () => {
  it('writes one for a subscription that ended within the last three days, once', async () => {
    const c = await creator();
    const s = await sub(c.id, { endsIn: -HOUR });
    expect(await schedule().scan()).toEqual({ reminders: 0, ended: 1 });
    const [e] = await events('subscription.ended');
    expect(e).toMatchObject({
      aggregateId: s.subscription.id,
      payload: { ends_at: at(-HOUR).toISOString() },
    });
    expect(e?.dedupeKey).toBe(
      `subscription:${s.subscription.id}:ends:${at(-HOUR).getTime()}:ended`,
    );
    expect(await schedule().scan()).toEqual({ reminders: 0, ended: 0 });
  });

  it('not for one that ended long ago, a revoked one, or a blocked customer or creator', async () => {
    const c = await creator();
    await sub(c.id, { endsIn: -4 * DAY });
    await sub(c.id, { endsIn: -HOUR, revoked: true });
    await sub(c.id, { endsIn: -HOUR, customer: { status: 'BLOCKED' } });
    const blocked = await creator('BLOCKED');
    await sub(blocked.id, { endsIn: -HOUR });
    expect((await schedule().scan()).ended).toBe(0);
  });

  it('a worker that was down catches up: the ended notice comes, a reminder for it never does', async () => {
    const c = await creator();
    await sub(c.id, { endsIn: 2 * DAY });
    // nothing ran for two and a half days
    const later = at(2 * DAY + 12 * HOUR);
    expect(await schedule().scan(later)).toEqual({ reminders: 0, ended: 1 });
    expect(await events('subscription.reminder_due')).toHaveLength(0);
  });

  it('a reminder and then the ended notice make two separate events for one period', async () => {
    const c = await creator();
    await sub(c.id, { endsIn: 2 * DAY });
    await schedule().scan();
    await schedule().scan(at(2 * DAY + HOUR));
    expect(await events('subscription.reminder_due')).toHaveLength(1);
    expect(await events('subscription.ended')).toHaveLength(1);
  });
});

describe('volume and concurrency', () => {
  it('pages through more than one batch, reminders and ended notices alike, writing each event once', async () => {
    const c = await creator();
    for (let i = 0; i < 12; i++) await sub(c.id, { endsIn: (i + 1) * HOUR });
    for (let i = 0; i < 7; i++) await sub(c.id, { endsIn: -(i + 1) * HOUR });
    const result = await schedule(3, 5).scan();
    expect(result).toEqual({ reminders: 12, ended: 7 });
    expect(await events('subscription.reminder_due')).toHaveLength(12);
    expect(await events('subscription.ended')).toHaveLength(7);
    expect(await schedule(3, 5).scan()).toEqual({ reminders: 0, ended: 0 });
  });

  it('two overlapping scans write each event once', async () => {
    const c = await creator();
    for (let i = 0; i < 12; i++) await sub(c.id, { endsIn: (i + 1) * HOUR });
    const [a, b] = await Promise.all([schedule(3, 5).scan(), schedule(3, 5).scan()]);
    expect(a.reminders + b.reminders).toBe(12);
    expect(await events('subscription.reminder_due')).toHaveLength(12);
  });
});
