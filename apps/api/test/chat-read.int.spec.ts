import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ChatHistoryResponseSchema,
  ChatUnreadResponseSchema,
  CreatorUnreadResponseSchema,
  ErrorResponseSchema,
  InboxResponseSchema,
  ReadResponseSchema,
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
  `inbx${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

/** A signed-in account that is promoted to CREATOR with a creator row. */
async function creatorSession() {
  const me = await signIn();
  await prisma.user.update({ where: { id: me.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({ data: { userId: me.userId, publicCode: code() } });
  return { ...me, creator };
}

/** A signed-in customer, a signed-in creator, their conversation and `count` customer messages. */
async function pair(count = 3) {
  const customer = await signIn();
  const creator = await creatorSession();
  await prisma.subscription.create({
    data: {
      customerId: customer.userId,
      creatorId: creator.creator.id,
      startsAt: new Date(Date.now() - 10 * DAY),
      endsAt: new Date(Date.now() + 10 * DAY),
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      customerId: customer.userId,
      creatorId: creator.creator.id,
      lastMessageSeq: count,
      lastMessageAt: new Date(),
    },
  });
  for (let seq = 1; seq <= count; seq++) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: customer.userId,
        body: `pesan ${seq}`,
        clientMessageId: randomUUID(),
        seq,
      },
    });
  }
  return { customer, creator, conversationId: conversation.id };
}

const auth = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
const postRead = (url: string, token: string | undefined, payload: unknown) =>
  t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
const customerRead = (id: string, token: string | undefined, through: unknown) =>
  postRead(`/v1/chats/${id}/read`, token, { through_seq: through });
const creatorRead = (id: string, token: string | undefined, through: unknown) =>
  postRead(`/v1/creator/inbox/${id}/read`, token, { through_seq: through });
const getJson = (url: string, token: string) =>
  t.app.inject({ method: 'GET', url, headers: auth(token) });
const cursorOf = async (conversationId: string, userId: string) =>
  (
    await prisma.conversationRead.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    })
  )?.lastReadSeq ?? null;

describe('roles and sessions', () => {
  it('no token 401; a CREATOR on the customer route and a USER on the creator routes 403; blocked 401', async () => {
    const p = await pair();
    expect((await customerRead(p.conversationId, undefined, 1)).statusCode).toBe(401);
    expect((await creatorRead(p.conversationId, undefined, 1)).statusCode).toBe(401);
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/creator/inbox/unread' })).statusCode,
    ).toBe(401);

    for (const res of [
      await customerRead(p.conversationId, p.creator.token, 1),
      await creatorRead(p.conversationId, p.customer.token, 1),
      await getJson('/v1/creator/inbox/unread', p.customer.token),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    }

    await prisma.user.update({ where: { id: p.customer.userId }, data: { status: 'BLOCKED' } });
    expect((await customerRead(p.conversationId, p.customer.token, 1)).statusCode).toBe(401);
    await prisma.user.update({ where: { id: p.creator.userId }, data: { status: 'BLOCKED' } });
    expect((await creatorRead(p.conversationId, p.creator.token, 1)).statusCode).toBe(401);
    expect(await prisma.conversationRead.count()).toBe(0);
  });
});

describe('IDOR', () => {
  it('another customer or creator, an unknown and a non-uuid id give the same 404 and store nothing', async () => {
    const mine = await pair();
    const other = await pair();
    const bodies = new Set<string>();
    const calls = [
      await customerRead(mine.conversationId, other.customer.token, 1),
      await creatorRead(mine.conversationId, other.creator.token, 1),
      await customerRead(randomUUID(), other.customer.token, 1),
      await creatorRead(randomUUID(), other.creator.token, 1),
      await customerRead('not-a-uuid', other.customer.token, 1),
      await creatorRead('not-a-uuid', other.creator.token, 1),
    ];
    for (const res of calls) {
      expect(res.statusCode).toBe(404);
      const { request_id: _r, ...rest } = ErrorResponseSchema.parse(res.json());
      bodies.add(JSON.stringify(rest));
    }
    expect(bodies.size).toBe(1);
    expect(await prisma.conversationRead.count()).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { type: 'read.updated' } })).toBe(0);
  });
});

describe('validation', () => {
  it.each([-1, 1.5, '3', null])('refuses through_seq %j with 400', async (v) => {
    const p = await pair();
    expect((await customerRead(p.conversationId, p.customer.token, v)).statusCode).toBe(400);
    expect((await creatorRead(p.conversationId, p.creator.token, v)).statusCode).toBe(400);
  });
  it('refuses a missing value and extra keys', async () => {
    const p = await pair();
    const url = `/v1/chats/${p.conversationId}/read`;
    expect((await postRead(url, p.customer.token, {})).statusCode).toBe(400);
    expect(
      (await postRead(url, p.customer.token, { through_seq: 1, user_id: p.creator.userId }))
        .statusCode,
    ).toBe(400);
    expect(await prisma.conversationRead.count()).toBe(0);
  });
});

describe('moving the cursor', () => {
  it('only forward, clamped to the newest message; the answer is the cursor', async () => {
    const p = await pair(5);
    const first = await creatorRead(p.conversationId, p.creator.token, 5);
    expect(first.statusCode).toBe(200);
    expect(ReadResponseSchema.parse(first.json())).toEqual({ last_read_seq: 5 });
    const back = await creatorRead(p.conversationId, p.creator.token, 3);
    expect(ReadResponseSchema.parse(back.json())).toEqual({ last_read_seq: 5 });
    expect(await cursorOf(p.conversationId, p.creator.userId)).toBe(5);
    const clamped = await customerRead(p.conversationId, p.customer.token, 999);
    expect(ReadResponseSchema.parse(clamped.json())).toEqual({ last_read_seq: 5 });
    expect(await cursorOf(p.conversationId, p.customer.userId)).toBe(5);
  });

  it('the caller can only move their own cursor', async () => {
    const p = await pair(2);
    await customerRead(p.conversationId, p.customer.token, 2);
    expect(await cursorOf(p.conversationId, p.customer.userId)).toBe(2);
    expect(await cursorOf(p.conversationId, p.creator.userId)).toBeNull();
  });

  it('works after the access ended', async () => {
    const p = await pair(1);
    await prisma.subscription.updateMany({ data: { endsAt: new Date(Date.now() - DAY) } });
    expect((await customerRead(p.conversationId, p.customer.token, 1)).statusCode).toBe(200);
  });
});

describe('counts and the marker follow the cursors', () => {
  it('the creator reading clears the inbox row, the chip and the badge; the customer sees "read" up to it', async () => {
    const p = await pair(3);
    const before = InboxResponseSchema.parse(
      (await getJson('/v1/creator/inbox', p.creator.token)).json(),
    );
    expect(before.items[0]!.unread_count).toBe(3);
    expect(before.unread_conversations).toBe(1);
    expect(
      CreatorUnreadResponseSchema.parse(
        (await getJson('/v1/creator/inbox/unread', p.creator.token)).json(),
      ),
    ).toEqual({ unread_conversations: 1 });

    await creatorRead(p.conversationId, p.creator.token, 2);
    const mid = InboxResponseSchema.parse(
      (await getJson('/v1/creator/inbox', p.creator.token)).json(),
    );
    expect(mid.items[0]!.unread_count).toBe(1);
    const history = ChatHistoryResponseSchema.parse(
      (await getJson(`/v1/chats/${p.conversationId}/messages`, p.customer.token)).json(),
    );
    expect(history.conversation.peer_read_seq).toBe(2);

    await creatorRead(p.conversationId, p.creator.token, 3);
    const after = InboxResponseSchema.parse(
      (await getJson('/v1/creator/inbox?filter=unread', p.creator.token)).json(),
    );
    expect(after.items).toEqual([]);
    expect(after.unread_conversations).toBe(0);
    expect(
      CreatorUnreadResponseSchema.parse(
        (await getJson('/v1/creator/inbox/unread', p.creator.token)).json(),
      ),
    ).toEqual({ unread_conversations: 0 });
  });

  it('the creator’s messages are unread for the customer until the customer reads', async () => {
    const p = await pair(1);
    await prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: p.conversationId },
        data: { lastMessageSeq: 2, lastMessageAt: new Date() },
      });
      await tx.message.create({
        data: {
          conversationId: p.conversationId,
          senderUserId: p.creator.userId,
          body: 'balasan',
          clientMessageId: randomUUID(),
          seq: 2,
        },
      });
    });
    const unread = async () =>
      ChatUnreadResponseSchema.parse((await getJson('/v1/chats/unread', p.customer.token)).json())
        .unread_total;
    expect(await unread()).toBe(1);
    await customerRead(p.conversationId, p.customer.token, 2);
    expect(await unread()).toBe(0);
  });

  it('the creator’s inbox never carries the customer’s cursor', async () => {
    const p = await pair(2);
    await customerRead(p.conversationId, p.customer.token, 2);
    const res = await getJson('/v1/creator/inbox', p.creator.token);
    expect(JSON.stringify(res.json())).not.toMatch(/read_seq|peer_read/);
  });
});
