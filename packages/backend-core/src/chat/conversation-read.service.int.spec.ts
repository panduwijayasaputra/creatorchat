import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorInboxService } from '../creator-inbox/creator-inbox.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ChatListService } from './chat-list.service.js';
import { ChatService } from './chat.service.js';
import { ConversationReadService } from './conversation-read.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-17T05:00:00.000Z');
const outbox = new OutboxService();
const chat = new ChatService(prisma, outbox, () => NOW);
const reads = new ConversationReadService(prisma, outbox);
const inbox = new CreatorInboxService(prisma, () => NOW);
const list = new ChatListService(prisma, () => NOW);
const DAY = 86_400_000;

let n = 97_000n;
let codeNo = 0;
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Raka', ...data } });

async function setup(over: { access?: 'active' | 'expired' } = {}) {
  const customer = await makeUser();
  const owner = await makeUser({ role: 'CREATOR', displayName: 'Salsa' });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `aaaaaaa${'abcdefgh'[codeNo++]}` },
  });
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(NOW.getTime() - 10 * DAY),
      endsAt: new Date(NOW.getTime() + (over.access === 'expired' ? -DAY : 10 * DAY)),
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, owner, creator, conversation };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const fromCustomer = (c: Ctx, body = 'halo') =>
  chat.send(c.customer.id, c.conversation.id, { clientMessageId: randomUUID(), body });

/** A creator message written straight to the tables (the creator send is US-029). */
async function fromCreator(c: Ctx, body = 'balas') {
  await prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.update({
      where: { id: c.conversation.id },
      data: { lastMessageSeq: { increment: 1 }, lastMessageAt: NOW },
    });
    await tx.message.create({
      data: {
        conversationId: c.conversation.id,
        senderUserId: c.owner.id,
        body,
        clientMessageId: randomUUID(),
        seq: conv.lastMessageSeq,
      },
    });
  });
}

const cursor = async (c: Ctx, userId: string) =>
  (
    await prisma.conversationRead.findUnique({
      where: { conversationId_userId: { conversationId: c.conversation.id, userId } },
    })
  )?.lastReadSeq ?? null;
const events = () => prisma.outboxEvent.findMany({ where: { type: 'read.updated' } });
const unreadCustomer = (c: Ctx) => list.unreadTotal(c.customer.id);
const unreadCreator = (c: Ctx) => inbox.unreadConversations(c.owner.id);

describe('advance', () => {
  it('each participant moves only their own cursor', async () => {
    const c = await setup();
    await fromCustomer(c);
    await fromCreator(c);
    expect(await reads.advance(c.customer.id, 'customer', c.conversation.id, 2)).toEqual({
      kind: 'ok',
      lastReadSeq: 2,
      moved: true,
    });
    expect(await cursor(c, c.customer.id)).toBe(2);
    expect(await cursor(c, c.owner.id)).toBeNull();
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 1);
    expect(await cursor(c, c.owner.id)).toBe(1);
    expect(await cursor(c, c.customer.id)).toBe(2);
  });

  it('interleaved sends and reads keep both unread counts right', async () => {
    const c = await setup();
    await fromCustomer(c); // 1
    await fromCustomer(c); // 2
    expect(await unreadCreator(c)).toBe(1);
    expect(await unreadCustomer(c)).toBe(0);
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 1);
    expect(await unreadCreator(c)).toBe(1); // seq 2 still unread
    await fromCreator(c); // 3
    expect(await unreadCustomer(c)).toBe(1);
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 3);
    expect(await unreadCreator(c)).toBe(0);
    await reads.advance(c.customer.id, 'customer', c.conversation.id, 3);
    expect(await unreadCustomer(c)).toBe(0);
    await fromCustomer(c); // 4
    expect(await unreadCreator(c)).toBe(1);
    expect(await unreadCustomer(c)).toBe(0);
  });

  it('is monotonic: an older value never lowers it and reports no move', async () => {
    const c = await setup();
    for (let i = 0; i < 5; i++) await fromCustomer(c);
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 5);
    expect(await reads.advance(c.owner.id, 'creator', c.conversation.id, 3)).toEqual({
      kind: 'ok',
      lastReadSeq: 5,
      moved: false,
    });
    expect(await cursor(c, c.owner.id)).toBe(5);
  });

  it('10 parallel advances end at the maximum', async () => {
    const c = await setup();
    for (let i = 0; i < 10; i++) await fromCustomer(c);
    await Promise.all(
      [3, 9, 1, 10, 4, 7, 2, 8, 5, 6].map((v) =>
        reads.advance(c.owner.id, 'creator', c.conversation.id, v),
      ),
    );
    expect(await cursor(c, c.owner.id)).toBe(10);
  });

  it('clamps to the newest message; 0 on an empty chat stores nothing and writes no event', async () => {
    const c = await setup();
    expect(await reads.advance(c.customer.id, 'customer', c.conversation.id, 0)).toEqual({
      kind: 'ok',
      lastReadSeq: 0,
      moved: false,
    });
    expect(await reads.advance(c.customer.id, 'customer', c.conversation.id, 99)).toMatchObject({
      lastReadSeq: 0,
      moved: false,
    });
    expect(await cursor(c, c.customer.id)).toBeNull();
    expect(await events()).toHaveLength(0);
    await fromCreator(c);
    await fromCreator(c);
    expect(await reads.advance(c.customer.id, 'customer', c.conversation.id, 99)).toMatchObject({
      lastReadSeq: 2,
      moved: true,
    });
  });

  it('writes one read.updated per real move, ids and a number only; a repeat writes nothing', async () => {
    const c = await setup();
    await fromCustomer(c);
    await fromCustomer(c);
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 1);
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 1);
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 2);
    const rows = await events();
    expect(rows).toHaveLength(2);
    expect(
      rows
        .map((r) => r.payload)
        .sort(
          (a, b) =>
            (a as { last_read_seq: number }).last_read_seq -
            (b as { last_read_seq: number }).last_read_seq,
        ),
    ).toEqual([
      { conversation_id: c.conversation.id, reader_id: c.owner.id, last_read_seq: 1 },
      { conversation_id: c.conversation.id, reader_id: c.owner.id, last_read_seq: 2 },
    ]);
  });

  it('IDOR: other customer, other creator, swapped roles, unknown id → not_found, nothing stored', async () => {
    const c = await setup();
    const d = await setup();
    await fromCustomer(c);
    const other = { kind: 'not_found' };
    expect(await reads.advance(d.customer.id, 'customer', c.conversation.id, 1)).toEqual(other);
    expect(await reads.advance(d.owner.id, 'creator', c.conversation.id, 1)).toEqual(other);
    expect(await reads.advance(c.owner.id, 'customer', c.conversation.id, 1)).toEqual(other);
    expect(await reads.advance(c.customer.id, 'creator', c.conversation.id, 1)).toEqual(other);
    expect(await reads.advance(c.customer.id, 'customer', randomUUID(), 1)).toEqual(other);
    expect(await prisma.conversationRead.count()).toBe(0);
    expect(await events()).toHaveLength(0);
  });

  it('works after the access ended and for a blocked creator’s chat', async () => {
    const c = await setup({ access: 'expired' });
    await fromCreator(c);
    expect(await reads.advance(c.customer.id, 'customer', c.conversation.id, 1)).toMatchObject({
      moved: true,
    });
    const d = await setup();
    await fromCreator(d);
    await prisma.creator.update({ where: { id: d.creator.id }, data: { status: 'BLOCKED' } });
    expect(await reads.advance(d.customer.id, 'customer', d.conversation.id, 1)).toMatchObject({
      moved: true,
    });
  });
});

describe('history shows the creator cursor to the customer only', () => {
  it('peerReadSeq follows the creator’s cursor and ignores the customer’s own', async () => {
    const c = await setup();
    await fromCustomer(c);
    await fromCustomer(c);
    const h0 = await chat.history(c.customer.id, c.conversation.id, { limit: 10 });
    expect(h0.kind === 'ok' && h0.history.conversation.peerReadSeq).toBe(0);
    await reads.advance(c.customer.id, 'customer', c.conversation.id, 2); // own cursor: no effect
    await reads.advance(c.owner.id, 'creator', c.conversation.id, 1);
    const h1 = await chat.history(c.customer.id, c.conversation.id, { limit: 10 });
    expect(h1.kind === 'ok' && h1.history.conversation.peerReadSeq).toBe(1);
  });
});

describe('CreatorInboxService.unreadConversations', () => {
  it('counts conversations, not messages, and is 0 for a user without a creator row', async () => {
    const c = await setup();
    const d = await setup();
    await fromCustomer(c);
    await fromCustomer(c);
    await fromCustomer(d);
    expect(await unreadCreator(c)).toBe(1);
    expect(await inbox.unreadConversations(c.customer.id)).toBe(0);
  });
});
