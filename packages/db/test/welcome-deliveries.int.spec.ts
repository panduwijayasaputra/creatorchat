import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 97_000n;
const ids = { customer: '', owner: '', creator: '', conversation: '' };

beforeEach(async () => {
  await resetDatabase(prisma);
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'abcdefgh' },
  });
  Object.assign(ids, {
    customer: customer.id,
    owner: owner.id,
    creator: creator.id,
    conversation: (
      await prisma.conversation.create({ data: { customerId: customer.id, creatorId: creator.id } })
    ).id,
  });
});
afterAll(() => prisma.$disconnect());

const delivery = (over: Record<string, unknown> = {}) =>
  prisma.welcomeDelivery.create({
    data: { creatorId: ids.creator, customerId: ids.customer, ...over },
  });

const message = () =>
  prisma.message.create({
    data: {
      conversationId: ids.conversation,
      senderUserId: ids.owner,
      body: 'Halo',
      clientMessageId: randomUUID(),
      seq: 1,
    },
  });

describe('welcome deliveries', () => {
  it('start without a message and get their own id', async () => {
    const row = await delivery();
    expect(row.messageId).toBeNull();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allow one per creator and customer, ever', async () => {
    await delivery();
    await expect(delivery()).rejects.toThrow();
    const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'D' } });
    await prisma.welcomeDelivery.create({ data: { creatorId: ids.creator, customerId: other.id } });
    expect(await prisma.welcomeDelivery.count()).toBe(2);
  });

  it('link to one message at most, and keep that message from being deleted', async () => {
    const m = await message();
    await delivery({ messageId: m.id });
    const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'D' } });
    await expect(
      prisma.welcomeDelivery.create({
        data: { creatorId: ids.creator, customerId: other.id, messageId: m.id },
      }),
    ).rejects.toThrow();
    await expect(prisma.message.delete({ where: { id: m.id } })).rejects.toThrow();
  });

  it('need an existing creator and customer', async () => {
    await expect(
      prisma.welcomeDelivery.create({
        data: { creatorId: '00000000-0000-4000-8000-000000000000', customerId: ids.customer },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.welcomeDelivery.create({
        data: { creatorId: ids.creator, customerId: '00000000-0000-4000-8000-000000000000' },
      }),
    ).rejects.toThrow();
  });
});
