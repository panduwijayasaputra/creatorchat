import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 95_000n;
const ids = { user: '', creator: '', conversation: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'abcdefgh' },
  });
  ids.user = customer.id;
  ids.creator = creator.id;
  ids.conversation = (
    await prisma.conversation.create({ data: { customerId: customer.id, creatorId: creator.id } })
  ).id;
});
afterAll(() => prisma.$disconnect());

describe('notification preferences', () => {
  it('start as on and content hidden, one row per user', async () => {
    const row = await prisma.notificationPreference.create({ data: { userId: ids.user } });
    expect(row).toMatchObject({ messagesEnabled: true, showContent: false });
    await expect(
      prisma.notificationPreference.create({ data: { userId: ids.user } }),
    ).rejects.toThrow();
  });

  it('need an existing user', async () => {
    await expect(
      prisma.notificationPreference.create({
        data: { userId: '00000000-0000-4000-8000-000000000000' },
      }),
    ).rejects.toThrow();
  });
});

describe('creator mutes', () => {
  it('one row per (user, creator)', async () => {
    await prisma.creatorMute.create({ data: { userId: ids.user, creatorId: ids.creator } });
    await expect(
      prisma.creatorMute.create({ data: { userId: ids.user, creatorId: ids.creator } }),
    ).rejects.toThrow();
    expect(await prisma.creatorMute.count()).toBe(1);
  });

  it('are kept while the creator exists (no cascade)', async () => {
    await prisma.creatorMute.create({ data: { userId: ids.user, creatorId: ids.creator } });
    await expect(prisma.creator.delete({ where: { id: ids.creator } })).rejects.toThrow();
  });
});

describe('notification state', () => {
  it('starts at 0, is one row per (conversation, user), and never negative', async () => {
    const row = await prisma.notificationState.create({
      data: { conversationId: ids.conversation, userId: ids.user },
    });
    expect(row.lastNotifiedSeq).toBe(0);
    await expect(
      prisma.notificationState.create({
        data: { conversationId: ids.conversation, userId: ids.user },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.notificationState.update({
        where: { conversationId_userId: { conversationId: ids.conversation, userId: ids.user } },
        data: { lastNotifiedSeq: -1 },
      }),
    ).rejects.toThrow();
  });
});
