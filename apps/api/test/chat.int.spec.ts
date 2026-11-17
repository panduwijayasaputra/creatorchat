import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ChatHistoryResponseSchema,
  ErrorResponseSchema,
  SendMessageResponseSchema,
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

/** A customer who is signed in, a creator, a subscription of the given kind and the conversation. */
async function chatFor(kind: 'active' | 'expired' | 'revoked' = 'active') {
  const me = await signIn();
  const owner = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: {
      userId: owner.id,
      publicCode: `chat${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`,
    },
  });
  const now = Date.now();
  await prisma.subscription.create({
    data: {
      customerId: me.userId,
      creatorId: creator.id,
      startsAt: new Date(now - 10 * DAY),
      endsAt: new Date(now + (kind === 'expired' ? -DAY : 10 * DAY)),
      revokedAt: kind === 'revoked' ? new Date(now - DAY / 2) : null,
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: me.userId, creatorId: creator.id },
  });
  return { ...me, owner, creator, conversationId: conversation.id };
}

const auth = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const send = (conversationId: string, token: string | undefined, payload: object) =>
  t.app.inject({
    method: 'POST',
    url: `/v1/chats/${conversationId}/messages`,
    headers: auth(token),
    payload,
  });
const history = (conversationId: string, token: string | undefined, query = '') =>
  t.app.inject({
    method: 'GET',
    url: `/v1/chats/${conversationId}/messages${query}`,
    headers: auth(token),
  });
const msg = (body = 'halo', id = randomUUID()) => ({ client_message_id: id, body });
const rows = async () => ({
  messages: await prisma.message.count(),
  outbox: await prisma.outboxEvent.count(),
});

describe('roles and sessions', () => {
  it('no token → 401; CREATOR → 403 FORBIDDEN_ROLE; blocked customer → 401', async () => {
    const c = await chatFor();
    expect((await send(c.conversationId, undefined, msg())).statusCode).toBe(401);
    expect((await history(c.conversationId, undefined)).statusCode).toBe(401);

    await prisma.user.update({ where: { id: c.userId }, data: { role: 'CREATOR' } });
    for (const res of [
      await send(c.conversationId, c.token, msg()),
      await history(c.conversationId, c.token),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    }

    await prisma.user.update({
      where: { id: c.userId },
      data: { role: 'USER', status: 'BLOCKED' },
    });
    expect((await send(c.conversationId, c.token, msg())).statusCode).toBe(401);
    expect(await rows()).toEqual({ messages: 0, outbox: 0 });
  });
});

describe('IDOR', () => {
  it('another customer, an unknown id and a non-uuid give the same 404 and store nothing', async () => {
    const mine = await chatFor();
    const other = await signIn();
    const bodies = new Set<string>();
    for (const id of [mine.conversationId, randomUUID(), 'not-a-uuid']) {
      for (const res of [await send(id, other.token, msg()), await history(id, other.token)]) {
        expect(res.statusCode).toBe(404);
        const { request_id: _r, ...rest } = ErrorResponseSchema.parse(res.json());
        bodies.add(JSON.stringify(rest));
      }
    }
    expect(bodies.size).toBe(1);
    expect(await rows()).toEqual({ messages: 0, outbox: 0 });
  });
});

describe('validation', () => {
  it.each([
    ['empty', msg('')],
    ['whitespace', msg('   ')],
    ['2001 characters', msg('a'.repeat(2001))],
    ['missing id', { body: 'halo' }],
    ['bad id', { client_message_id: 'x', body: 'halo' }],
    ['extra key', { ...msg(), sender: 'CREATOR' }],
  ])('refuses %s with 400', async (_name, payload) => {
    const c = await chatFor();
    const res = await send(c.conversationId, c.token, payload);
    expect(res.statusCode).toBe(400);
    expect(await rows()).toEqual({ messages: 0, outbox: 0 });
  });

  it.each(['limit=51', 'limit=0', 'before=0', 'before=abc', 'x=1'])('refuses ?%s', async (q) => {
    const c = await chatFor();
    expect((await history(c.conversationId, c.token, `?${q}`)).statusCode).toBe(400);
  });
});

describe('send', () => {
  it('201 once, then 200 with the same message for the same client_message_id', async () => {
    const c = await chatFor();
    const payload = msg('  halo  ');
    const first = await send(c.conversationId, c.token, payload);
    expect(first.statusCode).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const body = SendMessageResponseSchema.parse(first.json());
    expect(body.message).toMatchObject({ seq: 1, body: 'halo', sender: 'ME', type: 'TEXT' });
    const again = await send(c.conversationId, c.token, payload);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(await rows()).toEqual({ messages: 1, outbox: 1 });
  });

  it('409 IDEMPOTENCY_CONFLICT for the same id with other text', async () => {
    const c = await chatFor();
    const id = randomUUID();
    await send(c.conversationId, c.token, msg('satu', id));
    const res = await send(c.conversationId, c.token, msg('dua', id));
    expect(res.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await rows()).messages).toBe(1);
  });

  it.each(['expired', 'revoked'] as const)(
    '403 CHAT_ACCESS_EXPIRED when %s, history still readable',
    async (kind) => {
      const c = await chatFor(kind);
      const res = await send(c.conversationId, c.token, msg());
      expect(res.statusCode).toBe(403);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('CHAT_ACCESS_EXPIRED');
      expect(await rows()).toEqual({ messages: 0, outbox: 0 });
      const h = ChatHistoryResponseSchema.parse((await history(c.conversationId, c.token)).json());
      expect(h.conversation.access.state).toBe('EXPIRED');
      expect(h.conversation.access.ended_at).not.toBeNull();
    },
  );

  it('403 CHAT_CREATOR_BLOCKED, history still readable', async () => {
    const c = await chatFor();
    await prisma.creator.update({ where: { id: c.creator.id }, data: { status: 'BLOCKED' } });
    const res = await send(c.conversationId, c.token, msg());
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('CHAT_CREATOR_BLOCKED');
    expect(await rows()).toEqual({ messages: 0, outbox: 0 });
    const h = ChatHistoryResponseSchema.parse((await history(c.conversationId, c.token)).json());
    expect(h.conversation.access.state).toBe('CREATOR_BLOCKED');
  });
});

describe('history', () => {
  it('shows only what the customer may see, with no ids or AI fields', async () => {
    const c = await chatFor();
    await send(c.conversationId, c.token, msg('halo'));
    const res = await history(c.conversationId, c.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const h = ChatHistoryResponseSchema.parse(res.json());
    expect(h.conversation.access.state).toBe('ACTIVE');
    expect(h.conversation.creator.display_name).toBe('Salsa');
    const text = JSON.stringify(res.json());
    for (const hidden of [c.owner.id, c.creator.id, c.userId, 'mode', 'response_version', 'AI'])
      expect(text).not.toContain(hidden);
  });

  it('two pages cover every message once while a message is sent in between', async () => {
    const c = await chatFor();
    for (let i = 1; i <= 5; i++) await send(c.conversationId, c.token, msg(`m${i}`));
    const p1 = ChatHistoryResponseSchema.parse(
      (await history(c.conversationId, c.token, '?limit=3')).json(),
    );
    await send(c.conversationId, c.token, msg('baru'));
    const p2 = ChatHistoryResponseSchema.parse(
      (await history(c.conversationId, c.token, `?limit=3&before=${p1.next_before}`)).json(),
    );
    expect([...p1.items, ...p2.items].map((m) => m.seq)).toEqual([5, 4, 3, 2, 1]);
    expect(p2.next_before).toBeNull();
  });
});
