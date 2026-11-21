import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ErrorResponseSchema,
  MuteResponseSchema,
  NotificationPreferencesResponseSchema,
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
const DAY = 86_400_000;

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 10_100;
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
      USER_SESSION_SECRET: 'user-session-secret-'.padEnd(48, 'u'),
      ADMIN_ACCESS_TOKEN_SECRET: 'access-secret-'.padEnd(48, 'a'),
      ADMIN_REFRESH_TOKEN_SECRET: 'refresh-secret-'.padEnd(48, 'r'),
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
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id: nextTelegramId++, first_name: 'Nadia' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

const code = () =>
  `ntfc${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

async function creatorOf(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const login = await signIn();
  await prisma.user.update({ where: { id: login.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({
    data: { userId: login.userId, publicCode: code(), status },
  });
  return { login, creator };
}

/** A signed-in customer with a conversation (and an active subscription) with a fresh creator. */
async function customerWithCreator(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const customer = await signIn();
  const c = await creatorOf(status);
  await prisma.subscription.create({
    data: {
      customerId: customer.userId,
      creatorId: c.creator.id,
      startsAt: new Date(Date.now() - 10 * DAY),
      endsAt: new Date(Date.now() + 10 * DAY),
    },
  });
  await prisma.conversation.create({
    data: { customerId: customer.userId, creatorId: c.creator.id },
  });
  return { customer, ...c };
}

const call = (
  method: 'GET' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) =>
  t.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const PREFS = '/v1/me/notification-preferences';
const muteUrl = (publicCode: string) => `/v1/creators/by-code/${publicCode}/mute`;
const errorCode = (res: { json(): unknown }) => ErrorResponseSchema.parse(res.json()).code;

describe('GET and PATCH /v1/me/notification-preferences', () => {
  it('answers the defaults first, no-store, and writes nothing', async () => {
    const customer = await signIn();
    const res = await call('GET', PREFS, customer.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(NotificationPreferencesResponseSchema.parse(res.json())).toEqual({
      messages_enabled: true,
      show_content: false,
    });
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it('PATCH changes only the named switch and answers the whole state; a GET sees it', async () => {
    const customer = await signIn();
    const one = await call('PATCH', PREFS, customer.token, { show_content: true });
    expect(one.statusCode).toBe(200);
    expect(NotificationPreferencesResponseSchema.parse(one.json())).toEqual({
      messages_enabled: true,
      show_content: true,
    });
    const two = await call('PATCH', PREFS, customer.token, { messages_enabled: false });
    expect(NotificationPreferencesResponseSchema.parse(two.json())).toEqual({
      messages_enabled: false,
      show_content: true,
    });
    expect(
      NotificationPreferencesResponseSchema.parse(
        (await call('GET', PREFS, customer.token)).json(),
      ),
    ).toEqual({
      messages_enabled: false,
      show_content: true,
    });
  });

  it("a customer's choices never reach another customer", async () => {
    const a = await signIn();
    const b = await signIn();
    await call('PATCH', PREFS, a.token, { show_content: true });
    expect(
      NotificationPreferencesResponseSchema.parse((await call('GET', PREFS, b.token)).json())
        .show_content,
    ).toBe(false);
  });

  it('refuses an empty body, an unknown key (a user id included) and a non-boolean with 400', async () => {
    const customer = await signIn();
    for (const payload of [
      {},
      { user_id: customer.userId, show_content: true },
      { show_content: 'yes' },
    ]) {
      const res = await call('PATCH', PREFS, customer.token, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    }
    expect(await prisma.notificationPreference.count()).toBe(0);
  });

  it('no token 401, a creator 403 FORBIDDEN_ROLE, a blocked account 401', async () => {
    expect((await call('GET', PREFS)).statusCode).toBe(401);
    expect((await call('PATCH', PREFS, undefined, { show_content: true })).statusCode).toBe(401);
    const { login } = await creatorOf();
    for (const res of [
      await call('GET', PREFS, login.token),
      await call('PATCH', PREFS, login.token, { show_content: true }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN_ROLE');
    }
    const customer = await signIn();
    await prisma.user.update({ where: { id: customer.userId }, data: { status: 'BLOCKED' } });
    expect((await call('GET', PREFS, customer.token)).statusCode).toBe(401);
  });
});

describe('PUT and DELETE /v1/creators/by-code/:publicCode/mute', () => {
  it('mutes and unmutes a creator I have a conversation with, repeatably, and the Langganan card shows it', async () => {
    const r = await customerWithCreator();
    const put = await call('PUT', muteUrl(r.creator.publicCode), r.customer.token);
    expect(put.statusCode).toBe(200);
    expect(MuteResponseSchema.parse(put.json())).toEqual({ muted: true });
    expect((await call('PUT', muteUrl(r.creator.publicCode), r.customer.token)).statusCode).toBe(
      200,
    );
    expect(await prisma.creatorMute.count()).toBe(1);

    const list = SubscriptionsResponseSchema.parse(
      (await call('GET', '/v1/subscriptions', r.customer.token)).json(),
    );
    expect(list.items.map((i) => i.muted)).toEqual([true]);

    const del = await call('DELETE', muteUrl(r.creator.publicCode), r.customer.token);
    expect(del.statusCode).toBe(200);
    expect(MuteResponseSchema.parse(del.json())).toEqual({ muted: false });
    expect((await call('DELETE', muteUrl(r.creator.publicCode), r.customer.token)).statusCode).toBe(
      200,
    );
    expect(await prisma.creatorMute.count()).toBe(0);
    const after = SubscriptionsResponseSchema.parse(
      (await call('GET', '/v1/subscriptions', r.customer.token)).json(),
    );
    expect(after.items.map((i) => i.muted)).toEqual([false]);
  });

  it('an unrelated, an unknown and a malformed creator answer the same 404 CREATOR_NOT_FOUND and store nothing', async () => {
    const me = await signIn();
    const stranger = await creatorOf();
    const bodies = new Set<string>();
    for (const target of [stranger.creator.publicCode, 'zzzzzzzz', 'not-a-code']) {
      for (const method of ['PUT', 'DELETE'] as const) {
        const res = await call(method, muteUrl(target), me.token);
        expect(res.statusCode, `${method} ${target}`).toBe(404);
        expect(errorCode(res)).toBe('CREATOR_NOT_FOUND');
        bodies.add(JSON.stringify({ ...(res.json() as object), request_id: '' }));
      }
    }
    expect(bodies.size).toBe(1);
    expect(await prisma.creatorMute.count()).toBe(0);
  });

  it('a blocked creator cannot be muted (the same 404), but a mute made earlier can still be undone', async () => {
    const r = await customerWithCreator();
    expect((await call('PUT', muteUrl(r.creator.publicCode), r.customer.token)).statusCode).toBe(
      200,
    );
    await prisma.creator.update({ where: { id: r.creator.id }, data: { status: 'BLOCKED' } });
    const again = await call('PUT', muteUrl(r.creator.publicCode), r.customer.token);
    expect(again.statusCode).toBe(404);
    expect(errorCode(again)).toBe('CREATOR_NOT_FOUND');
    expect((await call('DELETE', muteUrl(r.creator.publicCode), r.customer.token)).statusCode).toBe(
      200,
    );
    expect(await prisma.creatorMute.count()).toBe(0);

    const blockedFromTheStart = await customerWithCreator('BLOCKED');
    const res = await call(
      'PUT',
      muteUrl(blockedFromTheStart.creator.publicCode),
      blockedFromTheStart.customer.token,
    );
    expect(res.statusCode).toBe(404);
  });

  it("one customer's mute does not touch another's, and cannot be undone by someone without the relation", async () => {
    const r = await customerWithCreator();
    const other = await signIn();
    await call('PUT', muteUrl(r.creator.publicCode), r.customer.token);
    expect((await call('DELETE', muteUrl(r.creator.publicCode), other.token)).statusCode).toBe(404);
    expect(await prisma.creatorMute.count()).toBe(1);
  });

  it('no token 401, a creator 403 FORBIDDEN_ROLE', async () => {
    const r = await customerWithCreator();
    expect((await call('PUT', muteUrl(r.creator.publicCode))).statusCode).toBe(401);
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await call(method, muteUrl(r.creator.publicCode), r.login.token);
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN_ROLE');
    }
  });
});
