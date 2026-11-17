import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const T = new Date('2026-11-16T00:00:00.000Z');

let n = 70_000n;
const ids = { admin: '', customer: '', creator: '', subscription: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  ids.admin = (
    await prisma.adminAccount.create({ data: { username: 'a.admin', passwordHash: 'x' } })
  ).id;
  ids.customer = (await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } })).id;
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  ids.creator = (
    await prisma.creator.create({ data: { userId: owner.id, publicCode: 'abcdefgh' } })
  ).id;
  ids.subscription = (
    await prisma.subscription.create({
      data: {
        customerId: ids.customer,
        creatorId: ids.creator,
        startsAt: T,
        endsAt: new Date(T.getTime() + 864e5),
      },
    })
  ).id;
});
afterAll(() => prisma.$disconnect());

const event = (reason = 'Kompensasi') =>
  prisma.subscriptionEvent.create({
    data: {
      subscriptionId: ids.subscription,
      type: 'GRANT',
      adminId: ids.admin,
      reason,
      startsAt: T,
    },
  });

describe('subscription_events', () => {
  it('is append-only: UPDATE and DELETE are rejected', async () => {
    const e = await event();
    await expect(
      prisma.subscriptionEvent.update({ where: { id: e.id }, data: { reason: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.subscriptionEvent.delete({ where: { id: e.id } })).rejects.toThrow(
      /append-only/,
    );
    expect(await prisma.subscriptionEvent.count()).toBe(1);
  });

  it('requires a reason of 1–300 characters', async () => {
    await expect(event('')).rejects.toThrow();
    await expect(event('x'.repeat(301))).rejects.toThrow();
    await expect(event('x'.repeat(300))).resolves.toBeTruthy();
  });

  it('restricts deleting a referenced subscription or admin', async () => {
    await event();
    await expect(prisma.subscription.delete({ where: { id: ids.subscription } })).rejects.toThrow();
    await expect(prisma.adminAccount.delete({ where: { id: ids.admin } })).rejects.toThrow();
  });
});

describe('conversations', () => {
  it('allows one conversation per customer–creator pair, MANUAL at version 0', async () => {
    const c = await prisma.conversation.create({
      data: { customerId: ids.customer, creatorId: ids.creator },
    });
    expect(c).toMatchObject({ mode: 'MANUAL', responseVersion: 0 });
    await expect(
      prisma.conversation.create({ data: { customerId: ids.customer, creatorId: ids.creator } }),
    ).rejects.toThrow();
  });

  it('restricts deleting a customer or creator that has a conversation', async () => {
    await prisma.conversation.create({
      data: { customerId: ids.customer, creatorId: ids.creator },
    });
    await prisma.subscription.delete({ where: { id: ids.subscription } });
    await expect(prisma.user.delete({ where: { id: ids.customer } })).rejects.toThrow();
    await expect(prisma.creator.delete({ where: { id: ids.creator } })).rejects.toThrow();
  });
});
