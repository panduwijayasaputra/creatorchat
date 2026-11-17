import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  CreatorProfileResponseSchema,
  ExploreResponseSchema,
  ErrorResponseSchema,
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

/** Logs a fresh Telegram account in (always a USER at first) and returns its token and id. */
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

const codeOf = () =>
  `exp${'abcdefgh'[nextCode++ % 8]}${'abcdefgh'[Math.floor(nextCode / 8) % 8]}bbb`.slice(0, 8);
async function creatorNamed(
  name: string,
  opts: { creatorBlocked?: boolean; userBlocked?: boolean } = {},
) {
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(nextTelegramId++),
      displayName: name,
      role: 'CREATOR',
      bio: `bio ${name}`,
      status: opts.userBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  const creator = await prisma.creator.create({
    data: {
      userId: user.id,
      publicCode: codeOf(),
      status: opts.creatorBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  return { user, creator };
}

const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const explore = (query = '', token?: string) => get(`/v1/creators${query}`, token);
const profile = (code: string, token?: string) => get(`/v1/creators/by-code/${code}`, token);
const DAY = 86_400_000;

describe('GET /v1/creators (Explore)', () => {
  it('answers a USER with only ACTIVE creators, the viewer-own chip, and no private data', async () => {
    const { token, userId } = await signIn();
    const salsa = await creatorNamed('Salsa');
    const dinda = await creatorNamed('Dinda');
    const kirana = await creatorNamed('Kirana');
    await creatorNamed('Citra', { creatorBlocked: true });
    await creatorNamed('Fajar', { userBlocked: true });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: salsa.creator.id,
        startsAt: new Date(Date.now() - 5 * DAY),
        endsAt: new Date(Date.now() + 5 * DAY),
      },
    });
    await prisma.accessRequest.create({
      data: { customerId: userId, creatorId: dinda.creator.id, type: 'TRIAL' },
    });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: kirana.creator.id,
        startsAt: new Date(Date.now() - 20 * DAY),
        endsAt: new Date(Date.now() - 5 * DAY),
      },
    });
    const res = await explore('', token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = ExploreResponseSchema.parse(res.json());
    expect(body).toMatchObject({ total: 3, page: 1, page_size: 20 });
    expect(Object.fromEntries(body.items.map((i) => [i.display_name, i.access]))).toEqual({
      Dinda: 'PENDING',
      Kirana: 'EXPIRED',
      Salsa: 'ACTIVE',
    });
    const raw = JSON.stringify(res.json());
    expect(raw).not.toMatch(/"id"|"status"|media|gallery|tiles|subscriber|ends_at|session|role/);
    expect(raw).not.toContain(salsa.creator.id);
  });

  it("does not show another customer's access", async () => {
    const { token } = await signIn();
    const other = await signIn();
    const c = await creatorNamed('Salsa');
    await prisma.subscription.create({
      data: {
        customerId: other.userId,
        creatorId: c.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    expect(
      ExploreResponseSchema.parse((await explore('', token)).json()).items[0]?.access,
    ).toBeNull();
  });

  it('pages, and refuses every bad query with a 400', async () => {
    const { token } = await signIn();
    for (let i = 0; i < 12; i++) await creatorNamed(`C${String(i).padStart(2, '0')}`);
    const p1 = ExploreResponseSchema.parse((await explore('?page_size=10', token)).json());
    const p2 = ExploreResponseSchema.parse((await explore('?page_size=10&page=2', token)).json());
    expect([p1.items.length, p2.items.length, p1.total]).toEqual([10, 2, 12]);
    expect(ExploreResponseSchema.parse((await explore('?page=9', token)).json())).toMatchObject({
      items: [],
      total: 12,
    });
    for (const bad of ['page=0', 'page=abc', 'page_size=15', 'extra=1', 'page=1&page=2']) {
      const res = await explore(`?${bad}`, token);
      expect(res.statusCode, bad).toBe(400);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a CREATOR (403 FORBIDDEN_ROLE), a call without a token (401) and never writes', async () => {
    const c = await creatorNamed('Salsa');
    const { token, userId } = await signIn();
    expect((await explore()).statusCode).toBe(401);
    const before = [
      await prisma.user.count(),
      await prisma.subscription.count(),
      await prisma.accessRequest.count(),
    ];
    await explore('', token);
    await profile(c.creator.publicCode, token);
    expect([
      await prisma.user.count(),
      await prisma.subscription.count(),
      await prisma.accessRequest.count(),
    ]).toEqual(before);
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    for (const res of [await explore('', token), await profile(c.creator.publicCode, token)]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_ROLE');
    }
  });
});

describe('GET /v1/creators/by-code/:publicCode (profile states)', () => {
  it('answers each of the four states over HTTP and an expired-a-second-ago access as EXPIRED', async () => {
    const { token, userId } = await signIn();
    const guest = await creatorNamed('Guest');
    const pending = await creatorNamed('Pending');
    const active = await creatorNamed('Active');
    const expired = await creatorNamed('Expired');
    const revoked = await creatorNamed('Revoked');
    await prisma.accessRequest.create({
      data: { customerId: userId, creatorId: pending.creator.id, type: 'RENEWAL' },
    });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: active.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: expired.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: revoked.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
        revokedAt: new Date(),
      },
    });
    const state = async (c: { creator: { publicCode: string } }) =>
      CreatorProfileResponseSchema.parse((await profile(c.creator.publicCode, token)).json())
        .access;
    expect(await state(guest)).toEqual({ state: 'GUEST' });
    expect(await state(pending)).toMatchObject({ state: 'PENDING', request_type: 'RENEWAL' });
    expect(await state(active)).toMatchObject({ state: 'ACTIVE' });
    expect(await state(expired)).toMatchObject({ state: 'EXPIRED', revoked: false });
    expect(await state(revoked)).toMatchObject({ state: 'EXPIRED', revoked: true });
  });

  it('contains no media, ids, counts or other customers; unknown, malformed and blocked codes are one identical 404', async () => {
    const { token } = await signIn();
    const ok = await creatorNamed('Salsa');
    const blocked = await creatorNamed('Citra', { creatorBlocked: true });
    const raw = JSON.stringify((await profile(ok.creator.publicCode, token)).json());
    expect(raw).not.toMatch(/"id"|"status"|media|gallery|tiles|subscriber|duration/);
    const messages = new Set<string>();
    for (const code of [blocked.creator.publicCode, 'abcdefgh', 'nope', '..%2Fx']) {
      const res = await profile(code, token);
      expect(res.statusCode, code).toBe(404);
      messages.add(ErrorResponseSchema.parse(res.json()).message);
    }
    expect(messages.size).toBe(1);
  });

  it('answers 401 without a token', async () => {
    const c = await creatorNamed('Salsa');
    expect((await profile(c.creator.publicCode)).statusCode).toBe(401);
  });
});
