import {
  AccountSecurityService,
  buildSignedInitData,
  loadEnv,
  signAccessToken,
} from '@creatorchat/backend-core';
import {
  CreatorSettingsResponseSchema,
  ErrorResponseSchema,
  MeResponseSchema,
  TIMEZONE_OPTIONS,
  TelegramLoginResponseSchema,
  UpdateTimezoneResponseSchema,
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
let security: AccountSecurityService;
let nextTelegramId = 9900;
let nextCode = 0;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  security = new AccountSecurityService(prisma);
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

async function login(id: number, firstName: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: firstName },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  return TelegramLoginResponseSchema.parse(res.json());
}

async function creatorSignIn() {
  const id = nextTelegramId++;
  const first = await login(id, 'Salsa');
  await security.changeRole(first.user.id, 'CREATOR');
  await prisma.creator.create({
    data: { userId: first.user.id, publicCode: `k4m5x2r${String.fromCharCode(97 + nextCode++)}` },
  });
  const second = await login(id, 'Salsa');
  return { token: second.access_token, userId: first.user.id };
}

async function customerSignIn() {
  const body = await login(nextTelegramId++, 'Maya');
  return { token: body.access_token, userId: body.user.id };
}

const patch = (payload: unknown, token?: string, url = '/v1/creator/timezone') =>
  t.app.inject({
    method: 'PATCH',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const get = (url: string, token: string) =>
  t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const zoneOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).timezone;

describe('PATCH /v1/creator/timezone', () => {
  it('saves each allowed zone and shows it on /v1/me and /v1/creator/settings', async () => {
    const { token, userId } = await creatorSignIn();
    for (const { id } of TIMEZONE_OPTIONS) {
      const res = await patch({ timezone: id }, token);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(UpdateTimezoneResponseSchema.parse(res.json()).timezone).toBe(id);
      expect(await zoneOf(userId)).toBe(id);
      expect(MeResponseSchema.parse((await get('/v1/me', token)).json()).timezone).toBe(id);
      const settings = CreatorSettingsResponseSchema.parse(
        (await get('/v1/creator/settings', token)).json(),
      );
      expect(settings.profile.timezone).toBe(id);
    }
  });

  it('a new account starts on Asia/Jakarta', async () => {
    const { token } = await creatorSignIn();
    expect(MeResponseSchema.parse((await get('/v1/me', token)).json()).timezone).toBe(
      'Asia/Jakarta',
    );
  });

  it('rejects anything outside the list with VALIDATION_FAILED and changes nothing', async () => {
    const { token, userId } = await creatorSignIn();
    await patch({ timezone: 'Asia/Makassar' }, token);
    for (const bad of [
      { timezone: 'Asia/Tokyo' },
      { timezone: 'UTC' },
      { timezone: '' },
      { timezone: 123 },
      { timezone: null },
      { timezone: 'Asia/jakarta' },
      { timezone: 'Asia/Jakarta; DROP TABLE users' },
      {},
    ]) {
      const res = await patch(bad, token);
      expect(res.statusCode).toBe(400);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    }
    expect((await patch(undefined, token)).statusCode).toBe(400);
    expect(await zoneOf(userId)).toBe('Asia/Makassar');
  });

  it('ignores other keys and changes no other column', async () => {
    const { token, userId } = await creatorSignIn();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const res = await patch(
      {
        timezone: 'Asia/Jayapura',
        id: 'x',
        user_id: 'x',
        role: 'USER',
        status: 'BLOCKED',
        display_name: 'hacker',
        bio: 'x',
      },
      token,
    );
    expect(res.statusCode).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after).toMatchObject({
      timezone: 'Asia/Jayapura',
      role: 'CREATOR',
      status: 'ACTIVE',
      displayName: before.displayName,
      bio: before.bio,
      sessionVersion: before.sessionVersion,
    });
  });

  it('is scoped to the caller: one creator never changes another', async () => {
    const a = await creatorSignIn();
    const b = await creatorSignIn();
    await patch({ timezone: 'Australia/Sydney' }, a.token);
    expect(await zoneOf(a.userId)).toBe('Australia/Sydney');
    expect(await zoneOf(b.userId)).toBe('Asia/Jakarta');
  });

  it('the same value twice is harmless', async () => {
    const { token } = await creatorSignIn();
    const first = await patch({ timezone: 'Asia/Singapore' }, token);
    const second = await patch({ timezone: 'Asia/Singapore' }, token);
    expect(second.json()).toEqual(first.json());
  });

  it('403 FORBIDDEN_ROLE for a USER with nothing written', async () => {
    const { token, userId } = await customerSignIn();
    const res = await patch({ timezone: 'Asia/Makassar' }, token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    expect(await zoneOf(userId)).toBe('Asia/Jakarta');
  });

  it('401 for no token, garbage and an admin token', async () => {
    for (const bad of [undefined, 'garbage']) {
      expect((await patch({ timezone: 'Asia/Makassar' }, bad)).statusCode).toBe(401);
    }
    const admin = await prisma.adminAccount.create({
      data: { username: 'root', passwordHash: 'x' },
    });
    const session = await prisma.session.create({
      data: { adminId: admin.id, refreshTokenHash: 'h', expiresAt: new Date(Date.now() + 60_000) },
    });
    const adminToken = await signAccessToken(
      ACCESS,
      { adminId: admin.id, sessionId: session.id },
      new Date(),
      900,
    );
    expect((await patch({ timezone: 'Asia/Makassar' }, adminToken)).statusCode).toBe(401);
  });

  it('rejects a blocked account, a blocked creators row and a stale session without writing', async () => {
    const blocked = await creatorSignIn();
    await security.blockUser(blocked.userId);
    expect((await patch({ timezone: 'Asia/Makassar' }, blocked.token)).statusCode).toBe(401);
    expect(await zoneOf(blocked.userId)).toBe('Asia/Jakarta');

    const row = await creatorSignIn();
    await prisma.creator.update({ where: { userId: row.userId }, data: { status: 'BLOCKED' } });
    expect((await patch({ timezone: 'Asia/Makassar' }, row.token)).statusCode).toBe(401);
    expect(await zoneOf(row.userId)).toBe('Asia/Jakarta');

    const stale = await creatorSignIn();
    await prisma.user.update({
      where: { id: stale.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    expect((await patch({ timezone: 'Asia/Makassar' }, stale.token)).statusCode).toBe(401);
    expect(await zoneOf(stale.userId)).toBe('Asia/Jakarta');
  });

  it('the profile routes ignore a timezone key', async () => {
    const { token, userId } = await creatorSignIn();
    const res = await patch(
      { display_name: 'Salsa', timezone: 'Asia/Makassar' },
      token,
      '/v1/creator/profile',
    );
    expect(res.statusCode).toBe(200);
    expect(await zoneOf(userId)).toBe('Asia/Jakarta');
  });
});
