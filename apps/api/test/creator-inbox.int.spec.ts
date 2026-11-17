import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ErrorResponseSchema,
  InboxResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
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
const MIN = 60_000;
const code = () =>
  `inbx${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

/** A signed-in account that is promoted to CREATOR with a creator row. */
async function creatorSession() {
  const me = await signIn();
  await prisma.user.update({ where: { id: me.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({ data: { userId: me.userId, publicCode: code() } });
  return { ...me, creator };
}

/** A customer with a running subscription and `count` messages in a conversation with the creator. */
async function chatWith(
  creator: { id: string },
  name: string,
  count: number,
  minutesAgo: number,
  telegramUsername = `${name.toLowerCase()}_handle`,
) {
  const customer = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: name, telegramUsername },
  });
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(Date.now() - 10 * DAY),
      endsAt: new Date(Date.now() + 10 * DAY),
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      lastMessageSeq: count,
      lastMessageAt: new Date(Date.now() - minutesAgo * MIN),
    },
  });
  for (let seq = 1; seq <= count; seq++) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: customer.id,
        body: `pesan ${seq} dari ${name}`,
        clientMessageId: randomUUID(),
        seq,
        createdAt: new Date(Date.now() - minutesAgo * MIN),
      },
    });
  }
  return { customer, conversation };
}

const get = (token: string | undefined, query = '') =>
  t.app.inject({
    method: 'GET',
    url: `/v1/creator/inbox${query}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe('roles and sessions', () => {
  it('no token → 401; USER → 403 FORBIDDEN_ROLE; blocked creator account → 401', async () => {
    expect((await get(undefined)).statusCode).toBe(401);
    const user = await signIn();
    const res = await get(user.token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');

    const c = await creatorSession();
    expect((await get(c.token)).statusCode).toBe(200);
    await prisma.user.update({ where: { id: c.userId }, data: { status: 'BLOCKED' } });
    expect((await get(c.token)).statusCode).toBe(401);
  });
});

describe('scope and privacy', () => {
  it('a creator sees only their own conversations, with no Telegram id, username or customer id', async () => {
    const a = await creatorSession();
    const b = await creatorSession();
    const mine = await chatWith(a.creator, 'Rani', 2, 5, 'rani_secret_handle');
    await chatWith(b.creator, 'Bayu', 1, 3);
    const res = await get(a.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = InboxResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.conversation_id)).toEqual([mine.conversation.id]);
    expect(body.items[0]).toMatchObject({
      customer: { display_name: 'Rani', avatar_url: null },
      unread_count: 2,
      access_active: true,
    });
    const text = JSON.stringify(res.json());
    for (const hidden of [
      mine.customer.id,
      String(mine.customer.telegramId),
      'rani_secret_handle',
      'Bayu',
    ])
      expect(text).not.toContain(hidden);
  });
});

describe('query', () => {
  it.each(['limit=0', 'limit=51', 'filter=manual', 'x=1', 'cursor=garbage', 'cursor='])(
    'refuses ?%s with 400',
    async (q) => {
      const c = await creatorSession();
      expect((await get(c.token, `?${q}`)).statusCode).toBe(400);
    },
  );

  it('two pages via next_cursor cover every conversation once', async () => {
    const c = await creatorSession();
    for (let i = 1; i <= 5; i++) await chatWith(c.creator, `Cust${i}`, 1, 100 - i);
    const p1 = InboxResponseSchema.parse((await get(c.token, '?limit=3')).json());
    expect(p1.next_cursor).not.toBeNull();
    const p2 = InboxResponseSchema.parse(
      (await get(c.token, `?limit=3&cursor=${p1.next_cursor}`)).json(),
    );
    expect(p2.next_cursor).toBeNull();
    expect([...p1.items, ...p2.items].map((i) => i.customer.display_name)).toEqual([
      'Cust5',
      'Cust4',
      'Cust3',
      'Cust2',
      'Cust1',
    ]);
  });

  it('filter=unread and unread_conversations', async () => {
    const c = await creatorSession();
    await chatWith(c.creator, 'Baru', 1, 5);
    const read = await chatWith(c.creator, 'Sudah', 1, 6);
    await prisma.conversationRead.create({
      data: { conversationId: read.conversation.id, userId: c.userId, lastReadSeq: 1 },
    });
    const body = InboxResponseSchema.parse((await get(c.token, '?filter=unread')).json());
    expect(body.items.map((i) => i.customer.display_name)).toEqual(['Baru']);
    expect(body.unread_conversations).toBe(1);
  });
});
