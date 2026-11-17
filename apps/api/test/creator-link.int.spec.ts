import { buildSignedInitData, loadEnv, signAccessToken } from '@creatorchat/backend-core';
import {
  CreatorProfileResponseSchema,
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
let nextTelegramId = 5000;

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

async function makeCreator(
  code: string,
  opts: { creatorBlocked?: boolean; userBlocked?: boolean } = {},
) {
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(nextTelegramId++),
      displayName: 'Salsa',
      role: 'CREATOR',
      avatarUrl: 'https://example.test/s.jpg',
      status: opts.userBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  await prisma.creator.create({
    data: { userId: user.id, publicCode: code, status: opts.creatorBlocked ? 'BLOCKED' : 'ACTIVE' },
  });
  return user;
}

const byCode = (code: string, token?: string) =>
  t.app.inject({
    method: 'GET',
    url: `/v1/creators/by-code/${encodeURIComponent(code)}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe('GET /v1/creators/by-code/:publicCode', () => {
  it('returns exactly public_code, display_name, bio, avatar_url and access to a signed-in USER and writes nothing', async () => {
    await makeCreator('k4m5x2qa');
    const { token } = await signIn();
    const before = [
      await prisma.user.count(),
      await prisma.session.count(),
      await prisma.creator.count(),
    ];
    const res = await byCode('k4m5x2qa', token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(CreatorProfileResponseSchema.parse(res.json())).toEqual({
      public_code: 'k4m5x2qa',
      display_name: 'Salsa',
      bio: null,
      avatar_url: 'https://example.test/s.jpg',
      conversation_id: null,
      access: { state: 'GUEST' },
    });
    expect(Object.keys(res.json()).sort()).toEqual([
      'access',
      'avatar_url',
      'bio',
      'conversation_id',
      'display_name',
      'public_code',
    ]);
    expect([
      await prisma.user.count(),
      await prisma.session.count(),
      await prisma.creator.count(),
    ]).toEqual(before);
  });

  it('gives byte-identical 404s for unknown, malformed, blocked creator and blocked account', async () => {
    await makeCreator('bbbbbbbb', { creatorBlocked: true });
    await makeCreator('cccccccc', { userBlocked: true });
    const { token } = await signIn();
    const bodies: string[] = [];
    for (const code of ['aaaaaaaa', 'ABCDEFGH', 'abcdefg', '..%2Fx', 'bbbbbbbb', 'cccccccc']) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/v1/creators/by-code/${code}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
      const body = ErrorResponseSchema.parse(res.json());
      expect(body.code).toBe('CREATOR_NOT_FOUND');
      bodies.push(JSON.stringify({ ...body, request_id: 'x' }));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('requires a valid session: no, malformed, revoked, stale-version and blocked callers get 401', async () => {
    await makeCreator('k4m5x2qa');
    expect((await byCode('k4m5x2qa')).statusCode).toBe(401);
    expect((await byCode('k4m5x2qa', 'not.a.token')).statusCode).toBe(401);

    const revoked = await signIn();
    await prisma.session.updateMany({
      where: { userId: revoked.userId },
      data: { revokedAt: new Date() },
    });
    expect((await byCode('k4m5x2qa', revoked.token)).statusCode).toBe(401);

    const stale = await signIn();
    await prisma.user.update({
      where: { id: stale.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    expect((await byCode('k4m5x2qa', stale.token)).statusCode).toBe(401);

    const blocked = await signIn();
    await prisma.user.update({ where: { id: blocked.userId }, data: { status: 'BLOCKED' } });
    expect((await byCode('k4m5x2qa', blocked.token)).statusCode).toBe(401);
  });

  it('rejects an admin access token used as a Bearer', async () => {
    await makeCreator('k4m5x2qa');
    const admin = await prisma.adminAccount.create({
      data: { username: 'link.admin', passwordHash: 'unused' },
    });
    const session = await prisma.session.create({
      data: { adminId: admin.id, refreshTokenHash: 'h', expiresAt: new Date(Date.now() + 1e9) },
    });
    const adminToken = await signAccessToken(
      ACCESS,
      { adminId: admin.id, sessionId: session.id },
      new Date(),
      900,
    );
    expect((await byCode('k4m5x2qa', adminToken)).statusCode).toBe(401);
  });

  it('answers 403 FORBIDDEN_ROLE to a CREATOR, for their own link and another creator’s', async () => {
    const other = await makeCreator('dddddddd');
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    await prisma.creator.create({ data: { userId, publicCode: 'eeeeeeee' } });
    for (const code of ['dddddddd', 'eeeeeeee']) {
      const res = await byCode(code, token);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_ROLE');
    }
    // No customer access, no role change.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('CREATOR');
    expect(other.id).not.toBe(userId);
  });

  it('ignores a forged role, user id or telegram id in headers and query', async () => {
    await makeCreator('k4m5x2qa');
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/creators/by-code/k4m5x2qa?role=USER&user_id=${userId}&telegram_id=1`,
      headers: { authorization: `Bearer ${token}`, 'x-role': 'USER', 'x-user-id': userId },
    });
    expect(res.statusCode).toBe(403);
  });
});
