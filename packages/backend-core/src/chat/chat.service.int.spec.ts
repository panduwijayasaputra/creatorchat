import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { ChatService } from './chat.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-17T05:00:00.000Z');
const chat = new ChatService(prisma, new OutboxService(), () => now);
const DAY = 86_400_000;
const ms = (d: number) => new Date(now.getTime() + d);

let n = 95_000n;
let codeNo = 0;
beforeEach(async () => {
  now = new Date('2026-11-17T05:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Raka Putra', ...data } });

/** A customer, a creator, a running subscription and the conversation between them. */
async function setup(over: { subscription?: 'active' | 'expired' | 'revoked' | 'none' } = {}) {
  const customer = await makeUser();
  const owner = await makeUser({ role: 'CREATOR', displayName: 'Salsa' });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `aaaaaaa${'abcdefgh'[codeNo++]}` },
  });
  const kind = over.subscription ?? 'active';
  if (kind !== 'none') {
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: ms(-10 * DAY),
        endsAt: kind === 'expired' ? ms(-DAY) : ms(10 * DAY),
        revokedAt: kind === 'revoked' ? ms(-DAY / 2) : null,
      },
    });
  }
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, owner, creator, conversation };
}

const send = (s: Awaited<ReturnType<typeof setup>>, body = 'halo', id = randomUUID()) =>
  chat.send(s.customer.id, s.conversation.id, { clientMessageId: id, body });

const counts = async () => ({
  messages: await prisma.message.count(),
  outbox: await prisma.outboxEvent.count(),
});

describe('ChatService.send', () => {
  it('stores the message with seq 1, 2 and one outbox event of ids only', async () => {
    const s = await setup();
    const a = await send(s, '  satu ');
    const b = await send(s, 'dua');
    expect(a).toMatchObject({ kind: 'created', message: { seq: 1, body: 'satu', sender: 'ME' } });
    expect(b).toMatchObject({ kind: 'created', message: { seq: 2 } });
    expect(await counts()).toEqual({ messages: 2, outbox: 2 });
    const event = await prisma.outboxEvent.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    expect(event.type).toBe('message.created');
    expect(event.payload).toEqual({
      message_id: (a as { message: { id: string } }).message.id,
      conversation_id: s.conversation.id,
      sender_id: s.customer.id,
    });
    expect(JSON.stringify(event.payload)).not.toContain('satu');
    expect((await prisma.message.findMany()).map((m) => m.origin)).toEqual(['MANUAL', 'MANUAL']);
  });

  it('sets last_message_at with the message and leaves it alone when the send is refused', async () => {
    const s = await setup();
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversation.id } }))
        .lastMessageAt,
    ).toBeNull();
    await send(s);
    const row = () => prisma.conversation.findUniqueOrThrow({ where: { id: s.conversation.id } });
    expect((await row()).lastMessageAt).toEqual(now);
    now = ms(20 * DAY); // access has ended by then
    expect(await send(s, 'later')).toEqual({ kind: 'access_expired' });
    expect((await row()).lastMessageAt).toEqual(new Date('2026-11-17T05:00:00.000Z'));
  });

  it('a retry with the same id returns the same message: one row, one event', async () => {
    const s = await setup();
    const id = randomUUID();
    const first = await send(s, 'halo', id);
    const again = await send(s, 'halo', id);
    expect(again).toMatchObject({ kind: 'replayed' });
    expect((again as { message: { id: string } }).message.id).toBe(
      (first as { message: { id: string } }).message.id,
    );
    expect(await counts()).toEqual({ messages: 1, outbox: 1 });
  });

  it('the same id with other text is a conflict and changes nothing', async () => {
    const s = await setup();
    const id = randomUUID();
    await send(s, 'halo', id);
    expect(await send(s, 'lain', id)).toEqual({ kind: 'conflict' });
    expect(await counts()).toEqual({ messages: 1, outbox: 1 });
  });

  it('10 parallel sends with the same id leave one row', async () => {
    const s = await setup();
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => send(s, 'halo', id)));
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'replayed')).toHaveLength(9);
    expect((await counts()).messages).toBe(1);
  });

  it('10 parallel sends with different ids get seq 1..10 without gaps', async () => {
    const s = await setup();
    await Promise.all(Array.from({ length: 10 }, (_, i) => send(s, `m${i}`)));
    const seqs = (await prisma.message.findMany({ orderBy: { seq: 'asc' } })).map((m) => m.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversation.id } });
    expect(conv.lastMessageSeq).toBe(10);
  });

  it.each(['expired', 'revoked', 'none'] as const)(
    'refuses with %s access and stores nothing',
    async (subscription) => {
      const s = await setup({ subscription });
      expect(await send(s)).toEqual({ kind: 'access_expired' });
      expect(await counts()).toEqual({ messages: 0, outbox: 0 });
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: s.conversation.id },
      });
      expect(conv.lastMessageSeq).toBe(0);
    },
  );

  it('refuses when the creator or the creator account is blocked', async () => {
    const a = await setup();
    await prisma.creator.update({ where: { id: a.creator.id }, data: { status: 'BLOCKED' } });
    expect(await send(a)).toEqual({ kind: 'creator_blocked' });
    const b = await setup();
    await prisma.user.update({ where: { id: b.owner.id }, data: { status: 'BLOCKED' } });
    expect(await send(b)).toEqual({ kind: 'creator_blocked' });
    expect(await counts()).toEqual({ messages: 0, outbox: 0 });
  });

  it('refuses a blocked customer', async () => {
    const s = await setup();
    await prisma.user.update({ where: { id: s.customer.id }, data: { status: 'BLOCKED' } });
    expect(await send(s)).toEqual({ kind: 'not_eligible' });
    expect(await counts()).toEqual({ messages: 0, outbox: 0 });
  });

  it('a replay after access ended still returns the stored message', async () => {
    const s = await setup();
    const id = randomUUID();
    await send(s, 'halo', id);
    now = ms(20 * DAY);
    expect(await send(s, 'halo', id)).toMatchObject({ kind: 'replayed' });
    expect(await send(s, 'baru')).toEqual({ kind: 'access_expired' });
  });

  it('refuses empty, whitespace and over-long text', async () => {
    const s = await setup();
    expect(await send(s, '   ')).toEqual({ kind: 'invalid' });
    expect(await send(s, 'a'.repeat(2001))).toEqual({ kind: 'invalid' });
    expect(await send(s, 'a'.repeat(2000))).toMatchObject({ kind: 'created' });
  });

  it('IDOR: another customer, an unknown id and a non-uuid all look the same', async () => {
    const s = await setup();
    const other = await makeUser();
    const body = { clientMessageId: randomUUID(), body: 'halo' };
    expect(await chat.send(other.id, s.conversation.id, body)).toEqual({ kind: 'not_found' });
    expect(await chat.send(s.customer.id, randomUUID(), body)).toEqual({ kind: 'not_found' });
    // the creator is not the customer of the conversation either
    expect(await chat.send(s.owner.id, s.conversation.id, body)).toEqual({ kind: 'not_found' });
    expect(await counts()).toEqual({ messages: 0, outbox: 0 });
  });
});

describe('ChatService.history', () => {
  const page = async (
    s: Awaited<ReturnType<typeof setup>>,
    q: { before?: number; limit: number },
  ) => {
    const r = await chat.history(s.customer.id, s.conversation.id, q);
    if (r.kind !== 'ok') throw new Error('not ok');
    return r.history;
  };

  async function seed(s: Awaited<ReturnType<typeof setup>>, count: number) {
    for (let i = 1; i <= count; i++) await send(s, `m${i}`);
  }

  it('returns newest first with next_before, null on the last page', async () => {
    const s = await setup();
    await seed(s, 5);
    const p1 = await page(s, { limit: 2 });
    expect(p1.items.map((m) => m.seq)).toEqual([5, 4]);
    expect(p1.nextBefore).toBe(4);
    const p2 = await page(s, { before: 4, limit: 2 });
    expect(p2.items.map((m) => m.seq)).toEqual([3, 2]);
    const p3 = await page(s, { before: 2, limit: 2 });
    expect(p3.items.map((m) => m.seq)).toEqual([1]);
    expect(p3.nextBefore).toBeNull();
  });

  it('exact fit: a full last page has no next page', async () => {
    const s = await setup();
    await seed(s, 4);
    expect((await page(s, { limit: 4 })).nextBefore).toBeNull();
  });

  it('is stable when new messages arrive between page requests', async () => {
    const s = await setup();
    await seed(s, 6);
    const p1 = await page(s, { limit: 3 });
    await seed(s, 3);
    const p2 = await page(s, { before: p1.nextBefore!, limit: 3 });
    const seen = [...p1.items, ...p2.items].map((m) => m.seq);
    expect(seen).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('maps senders to ME / CREATOR and exposes no ids', async () => {
    const s = await setup();
    await send(s, 'dari aku');
    await prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: s.conversation.id },
        data: { lastMessageSeq: 2 },
      });
      await tx.message.create({
        data: {
          conversationId: s.conversation.id,
          senderUserId: s.owner.id,
          body: 'dari creator',
          clientMessageId: randomUUID(),
          seq: 2,
        },
      });
    });
    const h = await page(s, { limit: 10 });
    expect(h.items.map((m) => m.sender)).toEqual(['CREATOR', 'ME']);
    expect(h.conversation.creator).toEqual({
      publicCode: s.creator.publicCode,
      displayName: 'Salsa',
      avatarUrl: null,
    });
    expect(JSON.stringify(h)).not.toContain(s.owner.id);
    expect(JSON.stringify(h)).not.toContain(s.creator.id);
  });

  it('stays readable when access expired or the creator is blocked', async () => {
    const s = await setup();
    await seed(s, 2);
    now = ms(20 * DAY);
    const expired = await page(s, { limit: 10 });
    expect(expired.items).toHaveLength(2);
    expect(expired.conversation.access.state).toBe('EXPIRED');
    await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
    const blocked = await page(s, { limit: 10 });
    expect(blocked.items).toHaveLength(2);
    expect(blocked.conversation.access.state).toBe('CREATOR_BLOCKED');
  });

  it('round-trips a 2000 character body', async () => {
    const s = await setup();
    await send(s, 'é'.repeat(2000));
    expect((await page(s, { limit: 1 })).items[0]!.body).toHaveLength(2000);
  });

  it('IDOR: another customer gets not_found', async () => {
    const s = await setup();
    const other = await makeUser();
    expect(await chat.history(other.id, s.conversation.id, { limit: 10 })).toEqual({
      kind: 'not_found',
    });
  });
});
