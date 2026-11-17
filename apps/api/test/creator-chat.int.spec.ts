import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  CreatorChatHistoryResponseSchema,
  CreatorCustomerDetailResponseSchema,
  CreatorSendMessageResponseSchema,
  ErrorResponseSchema,
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
const code = () =>
  `chat${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

/** A signed-in account that is promoted to CREATOR with a creator row. */
async function creatorSession() {
  const me = await signIn();
  await prisma.user.update({ where: { id: me.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({ data: { userId: me.userId, publicCode: code() } });
  return { ...me, creator };
}

/** A customer in a conversation with the creator; `access` decides the subscription. */
async function convo(
  creator: { id: string },
  name = 'Rani',
  access: 'active' | 'expired' = 'active',
  telegramUsername: string | null = 'rani.anggraini',
) {
  const customer = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: name, telegramUsername },
  });
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(Date.now() - 20 * DAY),
      endsAt: new Date(Date.now() + (access === 'expired' ? -DAY : 10 * DAY)),
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, conversation };
}

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const msgs = (id: string) => `/v1/creator/conversations/${id}/messages`;
const post = (id: string, token: string | undefined, body: object) =>
  call('POST', msgs(id), token, body);

describe('roles and sessions', () => {
  it('no token → 401; USER → 403 FORBIDDEN_ROLE; blocked creator account → 401', async () => {
    const c = await creatorSession();
    const { conversation } = await convo(c.creator);
    for (const [method, url] of [
      ['GET', msgs(conversation.id)],
      ['POST', msgs(conversation.id)],
      ['GET', `/v1/creator/conversations/${conversation.id}/customer`],
    ] as const) {
      expect((await call(method, url)).statusCode).toBe(401);
      const user = await signIn();
      const res = await call(method, url, user.token, method === 'POST' ? {} : undefined);
      expect(res.statusCode).toBe(403);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    }
    expect((await call('GET', msgs(conversation.id), c.token)).statusCode).toBe(200);
    await prisma.user.update({ where: { id: c.userId }, data: { status: 'BLOCKED' } });
    expect((await call('GET', msgs(conversation.id), c.token)).statusCode).toBe(401);
  });
});

describe('another creator, unknown and malformed ids', () => {
  it('all answer the same 404, for history, send and customer', async () => {
    const a = await creatorSession();
    const b = await creatorSession();
    const { conversation } = await convo(a.creator);
    const bodies = new Set<string>();
    const urls = [
      conversation.id, // someone else's
      randomUUID(),
      'not-a-uuid',
    ];
    for (const id of urls) {
      for (const [method, url, payload] of [
        ['GET', msgs(id)],
        ['POST', msgs(id), { client_message_id: randomUUID(), body: 'x' }],
        ['GET', `/v1/creator/conversations/${id}/customer`],
      ] as const) {
        const res = await call(method, url, b.token, payload);
        expect(res.statusCode).toBe(404);
        bodies.add(JSON.stringify({ ...res.json(), request_id: undefined }));
      }
    }
    expect(bodies.size).toBe(1);
    expect(await prisma.message.count()).toBe(0);
  });
});

describe('send and history', () => {
  it('201 then 200 on retry with one row, 409 on other text, origin MANUAL, no ids leaked', async () => {
    const c = await creatorSession();
    const { conversation, customer } = await convo(c.creator);
    const id = randomUUID();
    const first = await post(conversation.id, c.token, { client_message_id: id, body: ' halo ' });
    expect(first.statusCode).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(CreatorSendMessageResponseSchema.parse(first.json()).message).toMatchObject({
      body: 'halo',
      sender: 'ME',
      origin: 'MANUAL',
      seq: 1,
    });
    expect(
      (await post(conversation.id, c.token, { client_message_id: id, body: 'halo' })).statusCode,
    ).toBe(200);
    expect(
      (await post(conversation.id, c.token, { client_message_id: id, body: 'lain' })).statusCode,
    ).toBe(409);
    expect(await prisma.message.count()).toBe(1);

    const hist = await call('GET', msgs(conversation.id), c.token);
    const body = CreatorChatHistoryResponseSchema.parse(hist.json());
    expect(body.items).toHaveLength(1);
    expect(body.conversation.access.state).toBe('ACTIVE');
    const text = JSON.stringify(hist.json());
    for (const hidden of [customer.id, String(customer.telegramId), c.userId, 'rani.anggraini']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('the customer chat shows the reply without any origin', async () => {
    const c = await creatorSession();
    const { conversation, customer } = await convo(c.creator);
    await post(conversation.id, c.token, { client_message_id: randomUUID(), body: 'dari kreator' });
    const token = await (async () => {
      // Sign the customer in through the real login so the session is genuine.
      const me = await signIn();
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { customerId: me.userId },
      });
      await prisma.subscription.updateMany({
        where: { customerId: customer.id },
        data: { customerId: me.userId },
      });
      return me.token;
    })();
    const res = await call('GET', `/v1/chats/${conversation.id}/messages`, token);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain('dari kreator');
    expect(JSON.stringify(res.json())).not.toContain('origin');
  });

  it('refuses a send without active access (403, nothing stored) but history stays readable', async () => {
    const c = await creatorSession();
    const { conversation } = await convo(c.creator, 'Nadia', 'expired');
    const res = await post(conversation.id, c.token, {
      client_message_id: randomUUID(),
      body: 'x',
    });
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('CHAT_ACCESS_EXPIRED');
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
    const hist = CreatorChatHistoryResponseSchema.parse(
      (await call('GET', msgs(conversation.id), c.token)).json(),
    );
    expect(hist.conversation.access).toMatchObject({ state: 'EXPIRED' });
    expect(hist.conversation.access.ended_at).not.toBeNull();
  });

  it('rejects an unknown key, a blank body and a bad query', async () => {
    const c = await creatorSession();
    const { conversation } = await convo(c.creator);
    for (const payload of [
      { client_message_id: randomUUID(), body: 'x', origin: 'AI' },
      { client_message_id: randomUUID(), body: '   ' },
      { body: 'x' },
    ]) {
      expect((await post(conversation.id, c.token, payload)).statusCode).toBe(400);
    }
    for (const q of ['?limit=0', '?limit=51', '?before=0', '?x=1']) {
      expect((await call('GET', msgs(conversation.id) + q, c.token)).statusCode).toBe(400);
    }
    expect(await prisma.message.count()).toBe(0);
  });
});

describe('customer detail', () => {
  it('gives name, username and access, and nothing that identifies the account', async () => {
    const c = await creatorSession();
    const { conversation, customer } = await convo(c.creator);
    const res = await call('GET', `/v1/creator/conversations/${conversation.id}/customer`, c.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = CreatorCustomerDetailResponseSchema.parse(res.json());
    expect(body.customer).toEqual({
      display_name: 'Rani',
      avatar_url: null,
      username: 'rani.anggraini',
    });
    expect(body.access.state).toBe('ACTIVE');
    const text = JSON.stringify(res.json());
    for (const hidden of [customer.id, String(customer.telegramId), c.userId]) {
      expect(text).not.toContain(hidden);
    }
  });
});
