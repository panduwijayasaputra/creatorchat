import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ChatListResponseSchema,
  ChatUnreadResponseSchema,
  CreatorProfileResponseSchema,
  ErrorResponseSchema,
  SubscriptionsResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const USER_SECRET = 'user-session-secret-'.padEnd(48, 'u');
const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 7000;
let nextCode = 0;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: process.env.REDIS_URL,
      ALLOWED_ORIGINS: ORIGIN,
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_BOT_USERNAME: 'TestBot',
      USER_SESSION_SECRET: USER_SECRET,
      ADMIN_ACCESS_TOKEN_SECRET: ACCESS,
      ADMIN_REFRESH_TOKEN_SECRET: REFRESH,
      COOKIE_SECURE: 'false',
    }),
  );
});

afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  const keys = await redis.keys('test:user:login:*');
  if (keys.length > 0) await redis.del(...keys);
});

async function signIn(): Promise<{ token: string; userId: string }> {
  const id = nextTelegramId++;
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

const DAY = 86_400_000;
const auth = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, headers: auth(token) });
const list = (token?: string, query = '') => get(`/v1/chats${query}`, token);
const unread = (token?: string) => get('/v1/chats/unread', token);

async function creatorNamed(name: string, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const owner = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: name, role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: {
      userId: owner.id,
      publicCode: `cl${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bbbb`,
      status,
    },
  });
  return { owner, creator };
}

async function chatWith(
  customerId: string,
  c: { owner: { id: string }; creator: { id: string } },
  messages: { from: 'me' | 'creator'; body: string; ageMinutes: number }[],
  access: 'active' | 'expired' | 'none' = 'active',
) {
  const conversation = await prisma.conversation.create({
    data: { customerId, creatorId: c.creator.id },
  });
  let seq = 0;
  for (const m of messages) {
    seq += 1;
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: m.from === 'me' ? customerId : c.owner.id,
        body: m.body,
        clientMessageId: crypto.randomUUID(),
        seq,
        createdAt: new Date(Date.now() - m.ageMinutes * 60_000),
      },
    });
  }
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageSeq: seq },
  });
  if (access !== 'none') {
    await prisma.subscription.create({
      data: {
        customerId,
        creatorId: c.creator.id,
        startsAt: new Date(Date.now() - 20 * DAY),
        endsAt: new Date(Date.now() + (access === 'expired' ? -DAY : 10 * DAY)),
      },
    });
  }
  return conversation;
}

const counts = async () => [
  await prisma.user.count(),
  await prisma.conversation.count(),
  await prisma.message.count(),
  await prisma.conversationRead.count(),
  await prisma.outboxEvent.count(),
  await prisma.auditLog.count(),
];

describe('roles and sessions', () => {
  it('refuses a CREATOR (403 FORBIDDEN_ROLE), no token and a blocked customer (401) on both routes', async () => {
    const { token, userId } = await signIn();
    for (const call of [list, unread]) expect((await call()).statusCode).toBe(401);
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    for (const call of [list, unread]) expect((await call(token)).statusCode).toBe(401);
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', role: 'CREATOR' },
    });
    for (const call of [list, unread]) {
      const res = await call(token);
      expect(res.statusCode).toBe(403);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    }
  });
});

describe('GET /v1/chats', () => {
  it('lists my conversations with the exact contract, no-store, unread and access', async () => {
    const { token, userId } = await signIn();
    const salsa = await creatorNamed('Salsa Maheswari');
    const kirana = await creatorNamed('Kirana Larasati');
    const a = await chatWith(userId, salsa, [
      { from: 'creator', body: 'Versi pedas buat akhir pekan ini.', ageMinutes: 600 },
      { from: 'me', body: 'Pengin coba bikin roti sobek.', ageMinutes: 130 },
      { from: 'creator', body: 'Gagal pertama itu wajar kok.', ageMinutes: 120 },
    ]);
    await chatWith(
      userId,
      kirana,
      [{ from: 'creator', body: 'Sampai ketemu ya.', ageMinutes: 20000 }],
      'expired',
    );
    const res = await list(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = ChatListResponseSchema.parse(res.json());
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((i) => [i.display_name, i.unread_count, i.access])).toEqual([
      ['Salsa Maheswari', 2, 'ACTIVE'],
      ['Kirana Larasati', 1, 'EXPIRED'],
    ]);
    expect(body.items[0]).toMatchObject({
      conversation_id: a.id,
      last_message: { preview: 'Gagal pertama itu wajar kok.', media_kind: null },
    });
    expect(JSON.stringify(res.json())).not.toMatch(
      /creator_id|customer_id|"status"|thumbnail|attachment|asset|"body"|message_id/,
    );
  });

  it('pages by cursor over HTTP and refuses bad limits, cursors and keys', async () => {
    const { token, userId } = await signIn();
    for (let i = 0; i < 12; i++) {
      const c = await creatorNamed(`Creator ${i}`);
      await chatWith(userId, c, [{ from: 'creator', body: `m${i}`, ageMinutes: 100 + i }]);
    }
    const first = ChatListResponseSchema.parse((await list(token, '?limit=10')).json());
    expect(first.items).toHaveLength(10);
    expect(first.next_cursor).not.toBeNull();
    const second = ChatListResponseSchema.parse(
      (await list(token, `?limit=10&cursor=${encodeURIComponent(first.next_cursor!)}`)).json(),
    );
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.conversation_id);
    expect(new Set(ids).size).toBe(12);
    for (const bad of [
      '?limit=0',
      '?limit=15',
      '?limit=abc',
      '?limit=10&limit=20',
      '?extra=1',
      '?cursor=nope',
      '?cursor=',
    ]) {
      const res = await list(token, bad);
      expect(res.statusCode, bad).toBe(400);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    }
  });

  it('IDOR: two customers never see each other’s rows, counts or conversation ids', async () => {
    const a = await signIn();
    const b = await signIn();
    const salsa = await creatorNamed('Salsa');
    const theirs = await chatWith(a.userId, salsa, [
      { from: 'creator', body: 'rahasia A', ageMinutes: 5 },
    ]);
    const res = await list(b.token);
    expect(ChatListResponseSchema.parse(res.json()).items).toEqual([]);
    expect(res.body).not.toContain(theirs.id);
    expect(ChatUnreadResponseSchema.parse((await unread(b.token)).json()).unread_total).toBe(0);
    expect(ChatUnreadResponseSchema.parse((await unread(a.token)).json()).unread_total).toBe(1);
    // a cursor naming A's conversation id gives B nothing of A's
    const forged = Buffer.from(`${new Date().toISOString()}|${theirs.id}`).toString('base64url');
    const viaCursor = await list(b.token, `?cursor=${forged}`);
    expect(viaCursor.statusCode).toBe(200);
    expect(viaCursor.body).not.toContain('rahasia');
  });

  it('never writes, and marks a blocked creator', async () => {
    const { token, userId } = await signIn();
    const blocked = await creatorNamed('Citra', 'BLOCKED');
    await chatWith(userId, blocked, [{ from: 'creator', body: 'halo', ageMinutes: 5 }]);
    const before = await counts();
    const body = ChatListResponseSchema.parse((await list(token)).json());
    await unread(token);
    expect(body.items[0]?.access).toBe('CREATOR_BLOCKED');
    expect(await counts()).toEqual(before);
  });
});

describe('GET /v1/chats/unread', () => {
  it('sums the creator messages after my cursor across all conversations, expired ones included', async () => {
    const { token, userId } = await signIn();
    const a = await creatorNamed('A');
    const b = await creatorNamed('B');
    const conv = await chatWith(userId, a, [
      { from: 'creator', body: '1', ageMinutes: 30 },
      { from: 'creator', body: '2', ageMinutes: 20 },
    ]);
    await chatWith(userId, b, [{ from: 'creator', body: '1', ageMinutes: 10 }], 'expired');
    const read = async () =>
      ChatUnreadResponseSchema.parse((await unread(token)).json()).unread_total;
    expect(await read()).toBe(3);
    await prisma.conversationRead.create({
      data: { conversationId: conv.id, userId, lastReadSeq: 1 },
    });
    expect(await read()).toBe(2);
    const res = await unread(token);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is not captured by the conversation routes', async () => {
    const { token } = await signIn();
    expect((await unread(token)).statusCode).toBe(200);
    expect((await get('/v1/chats/not-a-uuid/messages', token)).statusCode).toBe(404);
  });
});

describe('conversation_id on the profile and Langganan answers', () => {
  it('is my own conversation or null, equals the list id, and never another customer’s', async () => {
    const me = await signIn();
    const other = await signIn();
    const withChat = await creatorNamed('WithChat');
    const without = await creatorNamed('Without');
    const mine = await chatWith(me.userId, withChat, [
      { from: 'creator', body: 'hi', ageMinutes: 5 },
    ]);
    await chatWith(other.userId, without, [{ from: 'creator', body: 'hi', ageMinutes: 5 }]);
    await prisma.subscription.create({
      data: {
        customerId: me.userId,
        creatorId: without.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });

    const profileOf = async (code: string) =>
      CreatorProfileResponseSchema.parse(
        (await get(`/v1/creators/by-code/${code}`, me.token)).json(),
      );
    expect((await profileOf(withChat.creator.publicCode)).conversation_id).toBe(mine.id);
    expect((await profileOf(without.creator.publicCode)).conversation_id).toBeNull();

    const subs = SubscriptionsResponseSchema.parse(
      (await get('/v1/subscriptions', me.token)).json(),
    );
    const byName = new Map(subs.items.map((i) => [i.display_name, i.conversation_id]));
    expect(byName.get('WithChat')).toBe(mine.id);
    expect(byName.get('Without')).toBeNull();
    const listed = ChatListResponseSchema.parse((await list(me.token)).json());
    expect(listed.items.map((i) => i.conversation_id)).toEqual([mine.id]);
  });
});
