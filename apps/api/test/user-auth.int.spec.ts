import { buildSignedInitData, loadEnv, signAccessToken } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  ErrorResponseSchema,
  MeResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, UNREACHABLE, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const USER_SECRET = 'user-session-secret-'.padEnd(48, 'u');
const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');

function envWith(overrides: Record<string, string | undefined> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    REDIS_URL: process.env.REDIS_URL,
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5174`,
    TELEGRAM_BOT_TOKEN: BOT,
    TELEGRAM_BOT_USERNAME: 'TestBot',
    TELEGRAM_INITDATA_MAX_AGE_SECONDS: '86400',
    USER_SESSION_SECRET: USER_SECRET,
    ADMIN_ACCESS_TOKEN_SECRET: ACCESS,
    ADMIN_REFRESH_TOKEN_SECRET: REFRESH,
    COOKIE_SECURE: 'false',
    ...overrides,
  });
}

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;

const nadia = { id: 424242, first_name: 'Nadia', last_name: 'Putri', username: 'nadia' };

function initData(
  user: { id: number; first_name: string; last_name?: string; username?: string } = nadia,
  authDate = new Date(),
): string {
  return buildSignedInitData({ botToken: BOT, user, authDate });
}

const loginRequest = (app: TestApp, data: string) =>
  app.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: { init_data: data },
  });

const me = (app: TestApp, token?: string, headers: Record<string, string> = {}) =>
  app.app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

async function signIn(data = initData()): Promise<{ token: string; userId: string }> {
  const res = await loginRequest(t, data);
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  t = await buildTestApp(envWith());
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

describe('POST /v1/auth/telegram', () => {
  it('logs in with valid initData, creating one USER and returning the profile', async () => {
    const res = await loginRequest(t, initData());
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = TelegramLoginResponseSchema.parse(res.json());
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(body.user).toMatchObject({
      telegram_id: '424242',
      role: 'USER',
      status: 'ACTIVE',
      display_name: 'Nadia Putri',
    });
    expect(typeof body.user.telegram_id).toBe('string');
    expect(await prisma.user.count()).toBe(1);

    const again = await loginRequest(t, initData());
    expect(again.statusCode).toBe(200);
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects forged, tampered, expired, empty and over-posted bodies without touching users', async () => {
    const forged = new URLSearchParams(initData());
    forged.set('hash', 'c'.repeat(64));
    const tampered = new URLSearchParams(initData());
    tampered.set('user', JSON.stringify({ ...nadia, id: 1 }));
    const expired = initData(nadia, new Date(Date.now() - 90_000_000));

    const invalid = await loginRequest(t, forged.toString());
    expect(invalid.statusCode).toBe(401);
    expect(ErrorResponseSchema.parse(invalid.json()).code).toBe('TELEGRAM_AUTH_INVALID');

    expect((await loginRequest(t, tampered.toString())).json().code).toBe('TELEGRAM_AUTH_INVALID');

    const old = await loginRequest(t, expired);
    expect(old.statusCode).toBe(401);
    expect(old.json().code).toBe('TELEGRAM_AUTH_EXPIRED');

    const empty = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram',
      payload: { init_data: '' },
    });
    expect(empty.statusCode).toBe(400);
    const extra = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram',
      payload: { init_data: initData(), role: 'CREATOR' },
    });
    expect(extra.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses a BLOCKED account and issues no session', async () => {
    const { userId } = await signIn();
    await prisma.session.deleteMany();
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    const res = await loginRequest(t, initData());
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ACCOUNT_BLOCKED');
    expect(await prisma.session.count()).toBe(0);
  });

  it('rate limits per IP with Retry-After', async () => {
    const expired = initData(nadia, new Date(Date.now() - 90_000_000));
    let last = await loginRequest(t, expired);
    for (let i = 0; i < 20; i += 1) last = await loginRequest(t, expired);
    expect(last.statusCode).toBe(429);
    expect(last.json().code).toBe('RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('blocks an IP that keeps sending invalid data', async () => {
    let status = 0;
    for (let i = 0; i < 6; i += 1) status = (await loginRequest(t, 'garbage')).statusCode;
    expect(status).toBe(429);
    expect((await loginRequest(t, initData())).statusCode).toBe(429);
  });

  it('answers a CORS preflight that allows the Authorization header', async () => {
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'authorization',
    );
  });

  it('never logs the initData, its hash, the token or the bot token', async () => {
    const data = initData();
    const { token } = await signIn(data);
    await loginRequest(t, 'bad-data-should-not-appear');
    await me(t, token);
    const raw = t.rawLogs();
    expect(raw).not.toContain(BOT);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(new URLSearchParams(data).get('hash') as string);
    expect(raw).not.toContain('bad-data-should-not-appear');
    expect(raw).not.toContain('init_data');
  });
});

describe('GET /v1/me', () => {
  it('returns the profile from the database', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { displayName: 'Edited' } });
    const res = await me(t, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = MeResponseSchema.parse(res.json());
    expect(body.display_name).toBe('Edited');
    expect(body.role).toBe('USER');
  });

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await me(t)).statusCode).toBe(401);
    expect((await me(t, 'not-a-jwt')).statusCode).toBe(401);
    expect((await me(t, undefined, { authorization: 'Basic abc' })).statusCode).toBe(401);
    const { token } = await signIn();
    const [h, p] = token.split('.');
    expect((await me(t, `${h}.${p}.AAAA`)).statusCode).toBe(401);
  });

  it('rejects an expired session and a revoked one', async () => {
    const { token } = await signIn();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(t, token)).statusCode).toBe(401);
    await prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
    });
    expect((await me(t, token)).statusCode).toBe(401);
  });

  it('rejects the old session after session_version changes, and after a block', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'CREATOR', sessionVersion: { increment: 1 } },
    });
    expect((await me(t, token)).statusCode).toBe(401);
    const fresh = await signIn();
    const profile = MeResponseSchema.parse((await me(t, fresh.token)).json());
    expect(profile.role).toBe('CREATOR');
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    expect((await me(t, fresh.token)).statusCode).toBe(401);
  });

  it('ignores role, user id and telegram id sent by the client', async () => {
    const { token, userId } = await signIn();
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/me?role=CREATOR&user_id=00000000-0000-0000-0000-000000000000&telegram_id=1',
      headers: {
        authorization: `Bearer ${token}`,
        'x-user-id': '00000000-0000-0000-0000-000000000000',
        'x-telegram-id': '1',
        'x-role': 'CREATOR',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = MeResponseSchema.parse(res.json());
    expect(body.id).toBe(userId);
    expect(body.role).toBe('USER');
    expect(body.telegram_id).toBe('424242');
  });

  it('does not accept cookies as credentials', async () => {
    const { token } = await signIn();
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: `${ADMIN_COOKIE.access}=${token}; access_token=${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('admin and user sessions are not interchangeable', () => {
  it('rejects an admin access token on /v1/me and a user token on the admin API', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'unused' },
    });
    const adminSession = await prisma.session.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: 'admin-hash',
        expiresAt: new Date(Date.now() + 1e9),
      },
    });
    const adminToken = await signAccessToken(
      ACCESS,
      { adminId: admin.id, sessionId: adminSession.id },
      new Date(),
      900,
    );
    // Sanity: this really is a valid admin token for the admin API.
    const adminOk = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: `${ADMIN_COOKIE.access}=${adminToken}` },
    });
    expect(adminOk.statusCode).toBe(200);
    expect((await me(t, adminToken)).statusCode).toBe(401);

    const { token } = await signIn();
    const asAdmin = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: `${ADMIN_COOKIE.access}=${token}` },
    });
    expect(asAdmin.statusCode).toBe(401);
    const asBearer = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asBearer.statusCode).toBe(401);
  });
});

describe('availability', () => {
  it('answers 503 when the bot token or session secret is missing, while health still works', async () => {
    const bare = await buildTestApp(
      envWith({ TELEGRAM_BOT_TOKEN: undefined, USER_SESSION_SECRET: undefined }),
    );
    try {
      const res = await loginRequest(bare, initData());
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('SERVICE_UNAVAILABLE');
      expect((await me(bare, 'anything')).statusCode).toBe(503);
      const health = await bare.app.inject({ method: 'GET', url: '/v1/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await bare.app.close();
    }
  });

  it('fails closed with 503 when Redis is unreachable and creates no user', async () => {
    const down = await buildTestApp(envWith({ REDIS_URL: UNREACHABLE.REDIS_URL }));
    try {
      const res = await loginRequest(down, initData());
      expect(res.statusCode).toBe(503);
      expect(await prisma.user.count()).toBe(0);
    } finally {
      await down.app.close();
    }
  });
});
