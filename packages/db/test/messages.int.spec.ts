import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 90_000n;
const ids = { customer: '', conversation: '' };
const CID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const CID2 = '1d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

const msg = (over: Record<string, unknown> = {}) =>
  prisma.message.create({
    data: {
      conversationId: ids.conversation,
      senderUserId: ids.customer,
      body: 'halo',
      clientMessageId: CID,
      seq: 1,
      ...over,
    },
  });

beforeEach(async () => {
  await resetDatabase(prisma);
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'abcdefgh' },
  });
  ids.customer = customer.id;
  ids.conversation = (
    await prisma.conversation.create({ data: { customerId: customer.id, creatorId: creator.id } })
  ).id;
});
afterAll(() => prisma.$disconnect());

describe('messages table', () => {
  it('starts every conversation at seq 0', async () => {
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: ids.conversation } });
    expect(c.lastMessageSeq).toBe(0);
  });

  it('refuses a duplicate seq and a duplicate client message id', async () => {
    await msg();
    await expect(msg({ clientMessageId: CID2 })).rejects.toThrow();
    await expect(msg({ seq: 2 })).rejects.toThrow();
    await msg({ seq: 2, clientMessageId: CID2 });
    expect(await prisma.message.count()).toBe(2);
  });

  it('enforces 1..2000 characters in the database', async () => {
    await expect(msg({ body: '' })).rejects.toThrow();
    await expect(msg({ body: 'a'.repeat(2001) })).rejects.toThrow();
    await msg({ body: 'a'.repeat(2000) });
  });

  it('blocks deleting a conversation or user that has messages', async () => {
    await msg();
    await expect(prisma.conversation.delete({ where: { id: ids.conversation } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: ids.customer } })).rejects.toThrow();
  });

  it('defaults origin to MANUAL and refuses an unknown origin', async () => {
    const m = await msg();
    expect(m.origin).toBe('MANUAL');
    await expect(msg({ seq: 2, clientMessageId: CID2, origin: 'BOT' })).rejects.toThrow();
  });
});
