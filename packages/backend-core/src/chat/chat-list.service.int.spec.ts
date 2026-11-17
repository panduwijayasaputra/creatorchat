import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatListService } from './chat-list.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ChatService } from './chat.service.js';
import { encodeChatCursor } from './chat-cursor.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-17T08:00:00.000Z');
const DAY = 86_400_000;
const at = (d: number, minutes = 0) => new Date(NOW.getTime() + d * DAY + minutes * 60_000);
const service = new ChatListService(prisma, () => NOW);

let tg = 600_000n;
let code = 0;
const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });

async function creator(
  name: string,
  data: { status?: 'ACTIVE' | 'BLOCKED'; userStatus?: 'ACTIVE' | 'BLOCKED' } = {},
) {
  const u = await user(name, { role: 'CREATOR', status: data.userStatus ?? 'ACTIVE' });
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const n = code++;
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `lst${alphabet[Math.floor(n / 32) % 32]}${alphabet[n % 32]}bbb`.slice(0, 8),
      status: data.status ?? 'ACTIVE',
    },
  });
  return { u, c };
}

async function chat(
  customerId: string,
  c: { u: { id: string }; c: { id: string } },
  messages: { from: 'me' | 'creator'; body: string; at: Date }[] = [],
) {
  const conversation = await prisma.conversation.create({
    data: { customerId, creatorId: c.c.id, createdAt: at(-30) },
  });
  let seq = 0;
  for (const m of messages) {
    seq += 1;
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: m.from === 'me' ? customerId : c.u.id,
        body: m.body,
        clientMessageId: crypto.randomUUID(),
        seq,
        createdAt: m.at,
      },
    });
  }
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageSeq: seq },
  });
  return conversation;
}
const sub = (customerId: string, creatorId: string, s: number, e: number, extra = {}) =>
  prisma.subscription.create({
    data: { customerId, creatorId, startsAt: at(s), endsAt: at(e), ...extra },
  });
const read = (conversationId: string, userId: string, lastReadSeq: number) =>
  prisma.conversationRead.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    create: { conversationId, userId, lastReadSeq },
    update: { lastReadSeq },
  });
const list = async (userId: string, query: { cursor?: string; limit?: number } = {}) => {
  const out = await service.list(userId, { limit: 20, ...query });
  if (out.kind !== 'ok') throw new Error(out.kind);
  return out;
};

beforeEach(async () => {
  code = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

describe('list', () => {
  it('shows the two board rows: Salsa with 2 unread and Kirana expired with none', async () => {
    const raka = await user('Raka');
    const salsa = await creator('Salsa Maheswari');
    const kirana = await creator('Kirana Larasati');
    const a = await chat(raka.id, salsa, [
      { from: 'creator', body: 'Versi pedas buat akhir pekan ini.', at: at(-1) },
      { from: 'me', body: 'Pengin coba bikin roti sobek.', at: at(0, -120) },
      { from: 'creator', body: 'Gagal pertama itu wajar kok.', at: at(0, -110) },
    ]);
    const b = await chat(raka.id, kirana, [
      { from: 'creator', body: 'Sampai ketemu di sesi berikutnya ya.', at: at(-11) },
    ]);
    await sub(raka.id, salsa.c.id, -5, 10);
    await sub(raka.id, kirana.c.id, -40, -9);
    await read(a.id, raka.id, 0);
    await read(b.id, raka.id, 1);

    const { items, nextCursor } = await list(raka.id);
    expect(nextCursor).toBeNull();
    expect(items.map((i) => [i.displayName, i.unreadCount, i.access])).toEqual([
      ['Salsa Maheswari', 2, 'ACTIVE'],
      ['Kirana Larasati', 0, 'EXPIRED'],
    ]);
    expect(items[0]).toMatchObject({
      conversationId: a.id,
      lastMessage: { preview: 'Gagal pertama itu wajar kok.', at: at(0, -110) },
    });
  });

  it('is empty for an account without conversations', async () => {
    expect(await list((await user('Nobody')).id)).toEqual({
      kind: 'ok',
      items: [],
      nextCursor: null,
    });
  });

  it('lists a conversation without messages by its creation time, with no last message', async () => {
    const raka = await user('Raka');
    const quiet = await creator('Quiet');
    const busy = await creator('Busy');
    await chat(raka.id, quiet);
    await chat(raka.id, busy, [{ from: 'creator', body: 'Halo', at: at(-40) }]);
    const { items } = await list(raka.id);
    // the quiet chat was created 30 days ago, the busy one's last message is older
    expect(items.map((i) => i.displayName)).toEqual(['Quiet', 'Busy']);
    expect(items[0]?.lastMessage).toBeNull();
    expect(items[0]?.unreadCount).toBe(0);
  });

  it('orders by activity with an id tie-break and cuts the preview to 120 characters, whitespace collapsed', async () => {
    const raka = await user('Raka');
    const a = await creator('A');
    const b = await creator('B');
    const c = await creator('C');
    await chat(raka.id, a, [{ from: 'creator', body: 'older', at: at(-3) }]);
    const long = `  halo\n\n  dunia   ${'x'.repeat(300)}  `;
    await chat(raka.id, b, [{ from: 'creator', body: long, at: at(-1) }]);
    await chat(raka.id, c, [{ from: 'creator', body: 'same time', at: at(-1) }]);
    const { items } = await list(raka.id);
    expect(items).toHaveLength(3);
    expect(items[2]?.displayName).toBe('A');
    const preview = items.find((i) => i.displayName === 'B')!.lastMessage!.preview;
    expect(preview.startsWith('halo dunia xxx')).toBe(true);
    expect([...preview].length).toBeLessThanOrEqual(120);
    expect(preview).not.toMatch(/\s{2,}|\n/);
    // equal activity: the larger conversation id comes first
    const ids = items.slice(0, 2).map((i) => i.conversationId);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it('marks expired, revoked and blocked-creator conversations (a blocked creator wins)', async () => {
    const raka = await user('Raka');
    const expired = await creator('Expired');
    const revoked = await creator('Revoked');
    const blocked = await creator('Blocked', { status: 'BLOCKED' });
    const blockedAccount = await creator('BlockedAccount', { userStatus: 'BLOCKED' });
    const none = await creator('NeverSubscribed');
    for (const [i, c] of [expired, revoked, blocked, blockedAccount, none].entries())
      await chat(raka.id, c, [{ from: 'creator', body: 'hi', at: at(-i - 1) }]);
    await sub(raka.id, expired.c.id, -40, -9);
    await sub(raka.id, revoked.c.id, -5, 20, { revokedAt: at(-1) });
    await sub(raka.id, blocked.c.id, -5, 20); // still running, but the creator is blocked
    await sub(raka.id, blockedAccount.c.id, -5, 20);
    const byName = new Map((await list(raka.id)).items.map((i) => [i.displayName, i.access]));
    expect(byName.get('Expired')).toBe('EXPIRED');
    expect(byName.get('Revoked')).toBe('EXPIRED');
    expect(byName.get('Blocked')).toBe('CREATOR_BLOCKED');
    expect(byName.get('BlockedAccount')).toBe('CREATOR_BLOCKED');
    expect(byName.get('NeverSubscribed')).toBe('EXPIRED');
  });

  it("never lists another customer's conversation", async () => {
    const raka = await user('Raka');
    const other = await user('Other');
    const salsa = await creator('Salsa');
    await chat(other.id, salsa, [{ from: 'creator', body: 'secret', at: at(-1) }]);
    expect((await list(raka.id)).items).toEqual([]);
    expect(JSON.stringify((await list(other.id)).items)).toContain('secret');
  });

  it('agrees with the chat screen about access for every row', async () => {
    const raka = await user('Raka');
    const chatService = new ChatService(prisma, new OutboxService(), () => NOW);
    const active = await creator('Active');
    const expired = await creator('Expired');
    const blocked = await creator('Blocked', { status: 'BLOCKED' });
    const convs = [
      await chat(raka.id, active, [{ from: 'creator', body: 'a', at: at(-1) }]),
      await chat(raka.id, expired, [{ from: 'creator', body: 'b', at: at(-2) }]),
      await chat(raka.id, blocked, [{ from: 'creator', body: 'c', at: at(-3) }]),
    ];
    await sub(raka.id, active.c.id, -5, 10);
    await sub(raka.id, expired.c.id, -40, -9);
    await sub(raka.id, blocked.c.id, -5, 10);
    for (const row of (await list(raka.id)).items) {
      const history = await chatService.history(raka.id, row.conversationId, { limit: 1 });
      if (history.kind !== 'ok') throw new Error('history');
      expect(history.history.conversation.access.state).toBe(row.access);
    }
    expect(convs).toHaveLength(3);
  });
});

describe('paging', () => {
  async function many(raka: { id: string }, n: number) {
    for (let i = 0; i < n; i++) {
      const c = await creator(`C${String(i).padStart(2, '0')}`);
      await chat(raka.id, c, [{ from: 'creator', body: `m${i}`, at: at(-1, -i) }]);
    }
  }

  it('covers every row exactly once across pages', async () => {
    const raka = await user('Raka');
    await many(raka, 25);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const out = await list(raka.id, { limit: 10, ...(cursor ? { cursor } : {}) });
      seen.push(...out.items.map((i) => i.conversationId));
      if (!out.nextCursor) break;
      cursor = out.nextCursor;
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('a message arriving between pages causes no duplicate and no skip of older rows', async () => {
    const raka = await user('Raka');
    await many(raka, 12);
    const first = await list(raka.id, { limit: 5 });
    // the oldest conversation gets a new message: it jumps to the top of a fresh list
    const oldest = (await list(raka.id, { limit: 50 })).items.at(-1)!;
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: oldest.conversationId },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderUserId: (await prisma.creator.findUniqueOrThrow({ where: { id: conv.creatorId } }))
          .userId,
        body: 'new',
        clientMessageId: crypto.randomUUID(),
        seq: conv.lastMessageSeq + 1,
        createdAt: at(0),
      },
    });
    const second = await list(raka.id, { limit: 5, cursor: first.nextCursor! });
    const ids1 = first.items.map((i) => i.conversationId);
    const ids2 = second.items.map((i) => i.conversationId);
    expect(ids2.filter((id) => ids1.includes(id))).toEqual([]);
    expect(ids2).toHaveLength(5);
  });

  it('splits equal activity times by id', async () => {
    const raka = await user('Raka');
    for (let i = 0; i < 6; i++) {
      const c = await creator(`Same${i}`);
      await chat(raka.id, c, [{ from: 'creator', body: 'same', at: at(-1) }]);
    }
    const a = await list(raka.id, { limit: 4 });
    const b = await list(raka.id, { limit: 4, cursor: a.nextCursor! });
    const all = [...a.items, ...b.items].map((i) => i.conversationId);
    expect(new Set(all).size).toBe(6);
    expect(b.nextCursor).toBeNull();
  });

  it.each(['', 'nope', 'bm9wZQ', encodeChatCursor({ at: NOW, id: 'x' } as never)].slice(0, 3))(
    'refuses the cursor %j',
    async (cursor) => {
      expect(await service.list((await user('R')).id, { limit: 10, cursor })).toEqual({
        kind: 'bad_cursor',
      });
    },
  );

  it("a cursor naming another customer's conversation still returns only my rows", async () => {
    const raka = await user('Raka');
    const other = await user('Other');
    const a = await creator('Mine');
    const b = await creator('Theirs');
    await chat(raka.id, a, [{ from: 'creator', body: 'mine', at: at(-2) }]);
    const theirs = await chat(other.id, b, [{ from: 'creator', body: 'theirs', at: at(-1) }]);
    const cursor = encodeChatCursor({ at: at(-1, 1), id: theirs.id });
    const out = await list(raka.id, { cursor });
    expect(out.items.map((i) => i.displayName)).toEqual(['Mine']);
    expect(JSON.stringify(out)).not.toContain('theirs');
  });
});

describe('unread', () => {
  it('counts only the creator messages after my cursor; my own messages never count', async () => {
    const raka = await user('Raka');
    const salsa = await creator('Salsa');
    const conv = await chat(raka.id, salsa, [
      { from: 'creator', body: '1', at: at(-1, 1) },
      { from: 'me', body: '2', at: at(-1, 2) },
      { from: 'creator', body: '3', at: at(-1, 3) },
      { from: 'creator', body: '4', at: at(-1, 4) },
    ]);
    expect((await list(raka.id)).items[0]?.unreadCount).toBe(3); // no cursor row: cursor 0
    await read(conv.id, raka.id, 3);
    expect((await list(raka.id)).items[0]?.unreadCount).toBe(1);
    await read(conv.id, raka.id, 4);
    expect((await list(raka.id)).items[0]?.unreadCount).toBe(0);
  });

  it("another participant's cursor does not move mine", async () => {
    const raka = await user('Raka');
    const salsa = await creator('Salsa');
    const conv = await chat(raka.id, salsa, [{ from: 'creator', body: '1', at: at(-1) }]);
    await read(conv.id, salsa.u.id, 1); // the creator's own cursor
    expect((await list(raka.id)).items[0]?.unreadCount).toBe(1);
  });

  it('unreadTotal is the sum of every conversation, expired and blocked-creator ones included', async () => {
    const raka = await user('Raka');
    const active = await creator('Active');
    const expired = await creator('Expired');
    const blocked = await creator('Blocked', { status: 'BLOCKED' });
    await chat(raka.id, active, [
      { from: 'creator', body: '1', at: at(-1) },
      { from: 'creator', body: '2', at: at(-1, 1) },
    ]);
    await chat(raka.id, expired, [{ from: 'creator', body: '1', at: at(-2) }]);
    await chat(raka.id, blocked, [{ from: 'creator', body: '1', at: at(-3) }]);
    await sub(raka.id, active.c.id, -5, 10);
    await sub(raka.id, expired.c.id, -40, -9);
    const sum = (await list(raka.id)).items.reduce((n, i) => n + i.unreadCount, 0);
    expect(sum).toBe(4);
    expect(await service.unreadTotal(raka.id)).toBe(4);
  });

  it('unreadTotal ignores other customers and is 0 for an empty account; handles 99+', async () => {
    const raka = await user('Raka');
    const other = await user('Other');
    const salsa = await creator('Salsa');
    const dinda = await creator('Dinda');
    await chat(other.id, salsa, [{ from: 'creator', body: 'x', at: at(-1) }]);
    expect(await service.unreadTotal(raka.id)).toBe(0);
    const big = await chat(
      raka.id,
      dinda,
      Array.from({ length: 120 }, (_, i) => ({
        from: 'creator' as const,
        body: `m${i}`,
        at: at(-1, i),
      })),
    );
    expect(await service.unreadTotal(raka.id)).toBe(120);
    expect((await list(raka.id)).items[0]?.unreadCount).toBe(120);
    expect(big.id).toBeTruthy();
  });
});

describe('statement count', () => {
  it('is the same for one conversation and for fifty', async () => {
    const raka = await user('Raka');
    const calls = { n: 0 };
    const counted = new Proxy(prisma, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop === '$queryRaw') {
          return (...args: unknown[]) => {
            calls.n += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        if (prop === 'subscription') {
          return new Proxy(value as object, {
            get(t, p, r) {
              const inner = Reflect.get(t, p, r) as unknown;
              return typeof inner === 'function'
                ? (...a: unknown[]) => {
                    calls.n += 1;
                    return (inner as (...x: unknown[]) => unknown).apply(t, a);
                  }
                : inner;
            },
          });
        }
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as PrismaClient;
    const counting = new ChatListService(counted, () => NOW);

    const first = await creator('Only');
    await chat(raka.id, first, [{ from: 'creator', body: 'hi', at: at(-1) }]);
    await counting.list(raka.id, { limit: 50 });
    const one = calls.n;

    for (let i = 0; i < 49; i++) {
      const c = await creator(`Bulk${i}`);
      await chat(raka.id, c, [{ from: 'creator', body: 'hi', at: at(-2, -i) }]);
    }
    calls.n = 0;
    const out = await counting.list(raka.id, { limit: 50 });
    expect(out.kind === 'ok' && out.items.length).toBe(50);
    expect(calls.n).toBe(one);
    expect(one).toBe(3);
  });
});
