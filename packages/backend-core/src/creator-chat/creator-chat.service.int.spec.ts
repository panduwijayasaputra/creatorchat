import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorInboxService } from '../creator-inbox/creator-inbox.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { CreatorChatService } from './creator-chat.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-17T05:00:00.000Z');
const chat = new CreatorChatService(prisma, new OutboxService(), () => now);
const DAY = 86_400_000;
const ms = (d: number) => new Date(now.getTime() + d);

let n = 97_000n;
let codeNo = 0;
beforeEach(async () => {
  now = new Date('2026-11-17T05:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Raka Putra', ...data } });

async function setup(
  over: {
    subscription?: 'active' | 'expired' | 'revoked' | 'none';
    customer?: Record<string, unknown>;
  } = {},
) {
  const customer = await makeUser(over.customer);
  const owner = await makeUser({ role: 'CREATOR', displayName: 'Salsa' });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `bbbbbbb${'abcdefgh'[codeNo++]}` },
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
type S = Awaited<ReturnType<typeof setup>>;

const send = (s: S, body = 'halo', id = randomUUID()) =>
  chat.send(s.owner.id, s.conversation.id, { clientMessageId: id, body });
const counts = async () => ({
  messages: await prisma.message.count(),
  outbox: await prisma.outboxEvent.count(),
});

describe('CreatorChatService.send', () => {
  it('stores a MANUAL message, one id-only outbox event, and moves the conversation up the inbox', async () => {
    const s = await setup();
    const other = await setup();
    await prisma.message.create({
      data: {
        conversationId: s.conversation.id,
        senderUserId: s.customer.id,
        body: 'hai',
        clientMessageId: randomUUID(),
        seq: 1,
        createdAt: ms(-1000),
      },
    });
    await prisma.conversation.update({
      where: { id: s.conversation.id },
      data: { lastMessageSeq: 1, lastMessageAt: ms(-1000) },
    });
    const a = await send(s, '  balasan ');
    expect(a).toMatchObject({
      kind: 'created',
      message: { seq: 2, body: 'balasan', sender: 'ME', origin: 'MANUAL' },
    });
    expect(await counts()).toEqual({ messages: 2, outbox: 1 });
    const event = await prisma.outboxEvent.findFirstOrThrow();
    expect(event.payload).toEqual({
      message_id: (a as { message: { id: string } }).message.id,
      conversation_id: s.conversation.id,
      sender_id: s.owner.id,
    });
    expect(JSON.stringify(event.payload)).not.toContain('balasan');
    const inbox = await new CreatorInboxService(prisma, () => now).list(s.owner.id, {
      filter: 'all',
      limit: 10,
    });
    expect(inbox).toMatchObject({ kind: 'ok', items: [{ preview: 'balasan' }] });
    expect(other.owner.id).not.toBe(s.owner.id);
  });

  it('replays the same id and text, refuses other text, and keeps one row', async () => {
    const s = await setup();
    const id = randomUUID();
    expect(await send(s, 'satu', id)).toMatchObject({ kind: 'created' });
    expect(await send(s, 'satu', id)).toMatchObject({ kind: 'replayed', message: { seq: 1 } });
    expect(await send(s, 'dua', id)).toEqual({ kind: 'conflict' });
    expect(await counts()).toEqual({ messages: 1, outbox: 1 });
  });

  it('serialises concurrent sends: one row per id, gap-free seq', async () => {
    const s = await setup();
    const same = randomUUID();
    await Promise.all(Array.from({ length: 10 }, () => send(s, 'sama', same)));
    expect(await prisma.message.count()).toBe(1);
    await Promise.all(Array.from({ length: 8 }, (_, i) => send(s, `m${i}`)));
    const seqs = (await prisma.message.findMany({ orderBy: { seq: 'asc' } })).map((m) => m.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('refuses without active access and stores nothing', async () => {
    const cases: Array<[string, () => Promise<S>]> = [
      ['expired', () => setup({ subscription: 'expired' })],
      ['revoked', () => setup({ subscription: 'revoked' })],
      ['none', () => setup({ subscription: 'none' })],
      ['blocked', () => setup({ customer: { status: 'BLOCKED' } })],
      ['promoted', () => setup({ customer: { role: 'CREATOR' } })],
    ];
    for (const [, make] of cases) {
      const s = await make();
      expect(await send(s)).toEqual({ kind: 'access_expired' });
      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversation.id } });
      expect(c.lastMessageSeq).toBe(0);
      expect(c.lastMessageAt).toBeNull();
    }
    expect(await counts()).toEqual({ messages: 0, outbox: 0 });
  });

  it('rejects blank and over-long bodies', async () => {
    const s = await setup();
    expect(await send(s, '   ')).toEqual({ kind: 'invalid' });
    expect(await send(s, 'x'.repeat(2001))).toEqual({ kind: 'invalid' });
  });

  it('never lets another creator, a customer or an unknown id in', async () => {
    const a = await setup();
    const b = await setup();
    const q = { limit: 30 };
    expect(await chat.history(b.owner.id, a.conversation.id, q)).toEqual({ kind: 'not_found' });
    expect(await chat.customerDetail(b.owner.id, a.conversation.id)).toEqual({ kind: 'not_found' });
    expect(
      await chat.send(b.owner.id, a.conversation.id, { clientMessageId: randomUUID(), body: 'x' }),
    ).toEqual({ kind: 'not_found' });
    expect(await chat.history(a.customer.id, a.conversation.id, q)).toEqual({ kind: 'not_found' });
    expect(await chat.history(a.owner.id, randomUUID(), q)).toEqual({ kind: 'not_found' });
    expect(await counts()).toEqual({ messages: 0, outbox: 0 });
  });

  it('treats a blocked creator account as not found', async () => {
    const s = await setup();
    await prisma.user.update({ where: { id: s.owner.id }, data: { status: 'BLOCKED' } });
    expect(await send(s)).toEqual({ kind: 'not_found' });
  });
});

describe('CreatorChatService.history and customerDetail', () => {
  it('pages newest first by seq, maps senders and origin, and stays readable after expiry', async () => {
    const s = await setup({ subscription: 'expired' });
    for (let i = 1; i <= 5; i++) {
      await prisma.message.create({
        data: {
          conversationId: s.conversation.id,
          senderUserId: i % 2 ? s.customer.id : s.owner.id,
          body: `m${i}`,
          clientMessageId: randomUUID(),
          seq: i,
        },
      });
    }
    const first = await chat.history(s.owner.id, s.conversation.id, { limit: 2 });
    if (first.kind !== 'ok') throw new Error('not ok');
    expect(first.history.items.map((m) => [m.seq, m.sender, m.origin])).toEqual([
      [5, 'CUSTOMER', 'MANUAL'],
      [4, 'ME', 'MANUAL'],
    ]);
    expect(first.history.nextBefore).toBe(4);
    expect(first.history.conversation.access).toEqual({ state: 'EXPIRED', endedAt: ms(-DAY) });
    const last = await chat.history(s.owner.id, s.conversation.id, { before: 2, limit: 2 });
    if (last.kind !== 'ok') throw new Error('not ok');
    expect(last.history.items.map((m) => m.seq)).toEqual([1]);
    expect(last.history.nextBefore).toBeNull();
  });

  it('reports the end of a revoked access as the revocation, and none without a subscription', async () => {
    const r = await setup({ subscription: 'revoked' });
    const none = await setup({ subscription: 'none' });
    expect(await chat.customerDetail(r.owner.id, r.conversation.id)).toMatchObject({
      access: { state: 'EXPIRED', endedAt: ms(-DAY / 2) },
    });
    expect(await chat.customerDetail(none.owner.id, none.conversation.id)).toMatchObject({
      access: { state: 'EXPIRED', endedAt: null },
    });
  });

  it('gives the username (or null) and nothing that identifies the account', async () => {
    const s = await setup({ customer: { telegramUsername: 'rani.anggraini' } });
    const bare = await setup();
    const a = await chat.customerDetail(s.owner.id, s.conversation.id);
    expect(a).toMatchObject({
      kind: 'ok',
      customer: { displayName: 'Raka Putra', username: 'rani.anggraini' },
      access: { state: 'ACTIVE', endsAt: ms(10 * DAY) },
    });
    expect(Object.keys((a as { customer: object }).customer).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'username',
    ]);
    expect(await chat.customerDetail(bare.owner.id, bare.conversation.id)).toMatchObject({
      customer: { username: null },
    });
  });
});
