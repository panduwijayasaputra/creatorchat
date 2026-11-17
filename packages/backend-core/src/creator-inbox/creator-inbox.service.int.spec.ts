import { decodeInboxCursor, encodeInboxCursor } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorInboxService, type InboxOutcome } from './creator-inbox.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-17T05:00:00.000Z');
const service = new CreatorInboxService(prisma, () => NOW);
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const MIN = 60_000;

let n = 96_000n;
let codeNo = 0;
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Customer', ...data } });

async function makeCreator(name = 'Salsa') {
  const user = await makeUser({ role: 'CREATOR', displayName: name });
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: `aaaaaaa${'abcdefgh'[codeNo++]}` },
  });
  return { user, creator };
}

/** A conversation with messages at the given minutes before NOW; `from` says who wrote each. */
async function chat(
  c: Awaited<ReturnType<typeof makeCreator>>,
  opts: {
    name?: string;
    messages?: { from: 'customer' | 'creator'; body?: string; minutesAgo: number }[];
    access?: 'active' | 'expired' | 'revoked' | 'none';
    customer?: Record<string, unknown>;
    readSeq?: number;
  } = {},
) {
  const customer = await makeUser({ displayName: opts.name ?? 'Rani Anggraini', ...opts.customer });
  const kind = opts.access ?? 'active';
  if (kind !== 'none') {
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: c.creator.id,
        startsAt: at(-10 * DAY),
        endsAt: at(kind === 'expired' ? -DAY : 10 * DAY),
        revokedAt: kind === 'revoked' ? at(-DAY / 2) : null,
      },
    });
  }
  const messages = opts.messages ?? [{ from: 'customer', minutesAgo: 5 }];
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: c.creator.id },
  });
  let seq = 0;
  for (const m of messages) {
    seq += 1;
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: m.from === 'customer' ? customer.id : c.user.id,
        body: m.body ?? `pesan ${seq}`,
        clientMessageId: randomUUID(),
        seq,
        createdAt: at(-m.minutesAgo * MIN),
      },
    });
  }
  if (messages.length > 0) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageSeq: seq,
        lastMessageAt: at(-Math.min(...messages.map((m) => m.minutesAgo)) * MIN),
      },
    });
  }
  if (opts.readSeq !== undefined) {
    await prisma.conversationRead.create({
      data: { conversationId: conversation.id, userId: c.user.id, lastReadSeq: opts.readSeq },
    });
  }
  return { customer, conversation };
}

const list = async (
  c: Awaited<ReturnType<typeof makeCreator>>,
  q: { filter?: 'all' | 'unread'; cursor?: string; limit?: number } = {},
) => {
  const r: InboxOutcome = await service.list(c.user.id, {
    filter: q.filter ?? 'all',
    cursor: q.cursor,
    limit: q.limit ?? 30,
  });
  if (r.kind !== 'ok') throw new Error(r.kind);
  return r;
};

describe('order and scope', () => {
  it('lists newest activity first, and a new message moves a chat to the top', async () => {
    const c = await makeCreator();
    const a = await chat(c, { name: 'A', messages: [{ from: 'customer', minutesAgo: 30 }] });
    const b = await chat(c, { name: 'B', messages: [{ from: 'customer', minutesAgo: 20 }] });
    expect((await list(c)).items.map((i) => i.customerName)).toEqual(['B', 'A']);
    await prisma.conversation.update({
      where: { id: a.conversation.id },
      data: { lastMessageAt: at(-1 * MIN) },
    });
    expect((await list(c)).items.map((i) => i.conversationId)).toEqual([
      a.conversation.id,
      b.conversation.id,
    ]);
  });

  it('leaves out conversations without messages', async () => {
    const c = await makeCreator();
    await chat(c, { messages: [] });
    await chat(c, { name: 'Ada' });
    expect((await list(c)).items.map((i) => i.customerName)).toEqual(['Ada']);
  });

  it('IDOR: another creator, a customer id and a creator without a row see none of it', async () => {
    const a = await makeCreator('A');
    const b = await makeCreator('B');
    const mine = await chat(a);
    expect((await list(b)).items).toEqual([]);
    expect((await list(a)).items.map((i) => i.conversationId)).toEqual([mine.conversation.id]);
    const asCustomer = await service.list(mine.customer.id, { filter: 'all', limit: 30 });
    expect(asCustomer).toEqual({ kind: 'ok', items: [], nextCursor: null, unreadConversations: 0 });
  });

  it('exposes no Telegram id, username or customer user id', async () => {
    const c = await makeCreator();
    const { customer } = await chat(c, { customer: { telegramUsername: 'rani_secret' } });
    const text = JSON.stringify(await list(c));
    expect(text).not.toContain(customer.id);
    expect(text).not.toContain(String(customer.telegramId));
    expect(text).not.toContain('rani_secret');
  });
});

describe('preview', () => {
  it('cuts at 120 characters and collapses whitespace; may be the creator’s own message', async () => {
    const c = await makeCreator();
    await chat(c, {
      messages: [
        { from: 'customer', minutesAgo: 10 },
        { from: 'creator', minutesAgo: 5, body: `Halo\n\n  kak   ${'x'.repeat(300)}` },
      ],
    });
    const preview = (await list(c)).items[0]!.preview;
    expect(preview.startsWith('Halo kak xxx')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(120);
  });
});

describe('unread', () => {
  it('counts only customer messages above the creator’s cursor', async () => {
    const c = await makeCreator();
    await chat(c, {
      name: 'A',
      messages: [
        { from: 'customer', minutesAgo: 30 },
        { from: 'creator', minutesAgo: 25 },
        { from: 'customer', minutesAgo: 20 },
        { from: 'customer', minutesAgo: 10 },
      ],
    });
    await chat(c, {
      name: 'B',
      messages: [
        { from: 'customer', minutesAgo: 40 },
        { from: 'customer', minutesAgo: 35 },
      ],
      readSeq: 1,
    });
    await chat(c, { name: 'C', messages: [{ from: 'creator', minutesAgo: 50 }] });
    const r = await list(c);
    const by = Object.fromEntries(r.items.map((i) => [i.customerName, i.unreadCount]));
    expect(by).toEqual({ A: 3, B: 1, C: 0 });
    expect(r.unreadConversations).toBe(2);
  });

  it('filter=unread lists only those, and the total still counts all', async () => {
    const c = await makeCreator();
    await chat(c, { name: 'Unread' });
    await chat(c, { name: 'Read', readSeq: 1 });
    const r = await list(c, { filter: 'unread' });
    expect(r.items.map((i) => i.customerName)).toEqual(['Unread']);
    expect(r.unreadConversations).toBe(1);
  });

  it('a cursor that has reached the last message leaves nothing unread', async () => {
    const c = await makeCreator();
    await chat(c, {
      messages: [
        { from: 'customer', minutesAgo: 5 },
        { from: 'customer', minutesAgo: 4 },
      ],
      readSeq: 2,
    });
    expect((await list(c)).unreadConversations).toBe(0);
  });
});

describe('access_active', () => {
  it.each([
    ['active', true],
    ['expired', false],
    ['revoked', false],
    ['none', false],
  ] as const)('%s → %s', async (access, expected) => {
    const c = await makeCreator();
    await chat(c, { access });
    expect((await list(c)).items[0]!.accessActive).toBe(expected);
  });

  it('a blocked customer or a blocked creator is not active', async () => {
    const a = await makeCreator('A');
    await chat(a, { customer: { status: 'BLOCKED' } });
    expect((await list(a)).items[0]!.accessActive).toBe(false);
    const b = await makeCreator('B');
    await chat(b);
    await prisma.creator.update({ where: { id: b.creator.id }, data: { status: 'BLOCKED' } });
    expect((await list(b)).items[0]!.accessActive).toBe(false);
  });
});

describe('pagination', () => {
  async function five(c: Awaited<ReturnType<typeof makeCreator>>) {
    for (let i = 1; i <= 5; i++) {
      await chat(c, { name: `C${i}`, messages: [{ from: 'customer', minutesAgo: 100 - i }] });
    }
  }

  it('pages of 2 over 5 conversations cover each once; the last page has no cursor', async () => {
    const c = await makeCreator();
    await five(c);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const r = await list(c, { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...r.items.map((i) => i.customerName));
      cursor = r.nextCursor ?? undefined;
      if (page < 2) expect(cursor).toBeDefined();
    }
    expect(cursor).toBeUndefined();
    expect(seen).toEqual(['C5', 'C4', 'C3', 'C2', 'C1']);
  });

  it('an exact fit has no next page', async () => {
    const c = await makeCreator();
    await five(c);
    expect((await list(c, { limit: 5 })).nextCursor).toBeNull();
  });

  it('a chat that moves to the top between pages is neither repeated nor does it make another one skipped', async () => {
    const c = await makeCreator();
    await five(c);
    const p1 = await list(c, { limit: 2 });
    const oldest = await prisma.conversation.findFirstOrThrow({
      where: { customer: { displayName: 'C1' } },
    });
    await prisma.conversation.update({ where: { id: oldest.id }, data: { lastMessageAt: at(-1) } });
    const p2 = await list(c, { limit: 5, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.customerName).sort()).toEqual(['C2', 'C3']);
  });

  it('ties on the same time are ordered by id and cross a page boundary cleanly', async () => {
    const c = await makeCreator();
    for (let i = 0; i < 4; i++)
      await chat(c, { name: `T${i}`, messages: [{ from: 'customer', minutesAgo: 7 }] });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await list(c, { limit: 3, ...(cursor ? { cursor } : {}) });
      ids.push(...r.items.map((i) => i.conversationId));
      cursor = r.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe('bad cursor', () => {
  it('garbage and tampered cursors are refused', async () => {
    const c = await makeCreator();
    await chat(c);
    expect(await service.list(c.user.id, { filter: 'all', limit: 5, cursor: 'garbage' })).toEqual({
      kind: 'bad_cursor',
    });
    const good = encodeInboxCursor(NOW, randomUUID());
    expect(decodeInboxCursor(good)).not.toBeNull();
    expect(
      await service.list(c.user.id, { filter: 'all', limit: 5, cursor: good.slice(0, -3) }),
    ).toEqual({ kind: 'bad_cursor' });
  });
});
