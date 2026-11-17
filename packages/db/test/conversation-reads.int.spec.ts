import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 91_000n;
const ids = { customer: '', conversation: '' };

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

const read = (over: Record<string, unknown> = {}) =>
  prisma.conversationRead.create({
    data: { conversationId: ids.conversation, userId: ids.customer, ...over },
  });

describe('conversation_reads', () => {
  it('one row per participant and conversation, cursor starts at 0', async () => {
    expect((await read()).lastReadSeq).toBe(0);
    await expect(read()).rejects.toThrow();
  });

  it('refuses a negative cursor', async () => {
    await expect(read({ lastReadSeq: -1 })).rejects.toThrow();
  });

  it('blocks deleting a user or conversation that has a cursor', async () => {
    await read();
    await expect(prisma.conversation.delete({ where: { id: ids.conversation } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: ids.customer } })).rejects.toThrow();
  });

  it('last_message_at is null on a new conversation', async () => {
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: ids.conversation } });
    expect(c.lastMessageAt).toBeNull();
  });

  it('the migration backfill gives a chat its latest message time and leaves an empty one NULL', async () => {
    const t1 = new Date('2026-11-01T01:00:00.000Z');
    const t2 = new Date('2026-11-02T01:00:00.000Z');
    for (const [seq, at] of [
      [1, t1],
      [2, t2],
    ] as const) {
      await prisma.message.create({
        data: {
          conversationId: ids.conversation,
          senderUserId: ids.customer,
          body: 'x',
          clientMessageId: `1d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e0${seq}`,
          seq,
          createdAt: at,
        },
      });
    }
    // The statement of migration 20261127010000_inbox.
    await prisma.$executeRawUnsafe(
      `UPDATE "conversations" c SET "last_message_at" = (SELECT max(m."created_at") FROM "messages" m WHERE m."conversation_id" = c."id")`,
    );
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: ids.conversation } });
    expect(c.lastMessageAt).toEqual(t2);
  });
});
