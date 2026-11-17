import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
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
  `sub${'abcdefgh'[nextCode++ % 8]}${'abcdefgh'[Math.floor(nextCode / 8) % 8]}bbb`.slice(0, 8);
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
const list = (token?: string, query = '') => get(`/v1/subscriptions${query}`, token);
const DAY = 86_400_000;
const sub = (customerId: string, creatorId: string, s: number, e: number, extra = {}) =>
  prisma.subscription.create({
    data: {
      customerId,
      creatorId,
      startsAt: new Date(Date.now() + s * DAY),
      endsAt: new Date(Date.now() + e * DAY),
      ...extra,
    },
  });
const counts = async () => [
  await prisma.user.count(),
  await prisma.subscription.count(),
  await prisma.accessRequest.count(),
  await prisma.outboxEvent.count(),
  await prisma.auditLog.count(),
];

describe('GET /v1/subscriptions', () => {
  it('answers a USER with the three board cards in order, no-store, exact contract', async () => {
    const { token, userId } = await signIn();
    const kirana = await creatorNamed('Kirana Larasati');
    const dinda = await creatorNamed('Dinda Prameswari');
    const salsa = await creatorNamed('Salsa Maheswari');
    await sub(userId, kirana.creator.id, -40, -9);
    await prisma.accessRequest.create({
      data: { customerId: userId, creatorId: dinda.creator.id, type: 'TRIAL' },
    });
    await sub(userId, salsa.creator.id, -5, 11);
    const res = await list(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = SubscriptionsResponseSchema.parse(res.json());
    expect(body.items.map((i) => `${i.display_name}:${i.access.state}`)).toEqual([
      'Salsa Maheswari:ACTIVE',
      'Dinda Prameswari:PENDING',
      'Kirana Larasati:EXPIRED',
    ]);
    expect(body.items.every((i) => i.creator_available)).toBe(true);
    expect(JSON.stringify(res.json())).not.toMatch(
      /"id"|"status"|media|gallery|tiles|subscriber|duration|reason|creator_id/,
    );
  });

  it('shows a revoked access as ended, a blocked creator as unavailable, and each state matches the profile', async () => {
    const { token, userId } = await signIn();
    const revoked = await creatorNamed('Revoked');
    const blocked = await creatorNamed('Citra', { creatorBlocked: true });
    await sub(userId, revoked.creator.id, -5, 20, { revokedAt: new Date() });
    await sub(userId, blocked.creator.id, -5, 10);
    const body = SubscriptionsResponseSchema.parse((await list(token)).json());
    const byName = new Map(body.items.map((i) => [i.display_name, i]));
    expect(byName.get('Revoked')?.access).toMatchObject({ state: 'EXPIRED', revoked: true });
    expect(byName.get('Citra')).toMatchObject({
      creator_available: false,
      access: { state: 'ACTIVE' },
    });
    const profile = await get(`/v1/creators/by-code/${revoked.creator.publicCode}`, token);
    expect(CreatorProfileResponseSchema.parse(profile.json()).access).toEqual(
      byName.get('Revoked')?.access,
    );
    // the blocked creator's profile is unreachable: that is why its card has no actions
    expect(
      (await get(`/v1/creators/by-code/${blocked.creator.publicCode}`, token)).statusCode,
    ).toBe(404);
  });

  it('an access that ended a second ago is EXPIRED', async () => {
    const { token, userId } = await signIn();
    const c = await creatorNamed('Edge');
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: c.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      SubscriptionsResponseSchema.parse((await list(token)).json()).items[0]?.access.state,
    ).toBe('EXPIRED');
  });

  it('never shows another customer’s relations (two sessions)', async () => {
    const a = await signIn();
    const b = await signIn();
    const salsa = await creatorNamed('Salsa');
    const dinda = await creatorNamed('Dinda');
    await sub(a.userId, salsa.creator.id, -5, 10);
    await prisma.accessRequest.create({
      data: { customerId: a.userId, creatorId: dinda.creator.id, type: 'TRIAL' },
    });
    expect(SubscriptionsResponseSchema.parse((await list(b.token)).json()).items).toEqual([]);
    expect(SubscriptionsResponseSchema.parse((await list(a.token)).json()).items).toHaveLength(2);
  });

  it('ignores a query string, and an empty account gets an empty list', async () => {
    const a = await signIn();
    const other = await signIn();
    const salsa = await creatorNamed('Salsa');
    await sub(other.userId, salsa.creator.id, -5, 10);
    const res = await list(a.token, `?user_id=${other.userId}&customer_id=${other.userId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('refuses a CREATOR (403 FORBIDDEN_ROLE), no token and an admin token (401), and never writes', async () => {
    const { token, userId } = await signIn();
    const salsa = await creatorNamed('Salsa');
    await sub(userId, salsa.creator.id, -5, 10);
    expect((await list()).statusCode).toBe(401);
    const before = await counts();
    await list(token);
    expect(await counts()).toEqual(before);
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    const res = await list(token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
  });

  it('refuses a blocked account (401)', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    expect((await list(token)).statusCode).toBe(401);
  });
});
