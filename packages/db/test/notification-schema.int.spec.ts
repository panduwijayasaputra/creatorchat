import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma = createTestPrisma();

async function seed() {
  const user = await prisma.user.create({
    data: { telegramId: 111n, displayName: 'Maya' },
  });
  const event = await prisma.outboxEvent.create({
    data: {
      type: 'creator_application.approved',
      aggregateType: 'creator_application',
      aggregateId: user.id,
      payload: {},
      dedupeKey: 'k1',
    },
  });
  return { user, event };
}

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('notification_deliveries', () => {
  it('applies defaults and leaves existing users and events usable', async () => {
    const { user, event } = await seed();
    expect(user.botBlockedAt).toBeNull();
    expect(event).toMatchObject({ status: 'PENDING', enqueuedAt: null, lastError: null });
    const row = await prisma.notificationDelivery.create({
      data: { dedupeKey: 'd1', outboxEventId: event.id, userId: user.id, kind: 'x' },
    });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0, ambiguousAttempts: 0 });
  });

  it('refuses a second delivery with the same dedupe key', async () => {
    const { user, event } = await seed();
    const data = { dedupeKey: 'd1', outboxEventId: event.id, userId: user.id, kind: 'x' };
    await prisma.notificationDelivery.create({ data });
    await expect(prisma.notificationDelivery.create({ data })).rejects.toThrow();
  });

  it('refuses an unknown user or event', async () => {
    const { user, event } = await seed();
    const ghost = '00000000-0000-4000-8000-000000000000';
    await expect(
      prisma.notificationDelivery.create({
        data: { dedupeKey: 'a', outboxEventId: event.id, userId: ghost, kind: 'x' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.notificationDelivery.create({
        data: { dedupeKey: 'b', outboxEventId: ghost, userId: user.id, kind: 'x' },
      }),
    ).rejects.toThrow();
  });
});
