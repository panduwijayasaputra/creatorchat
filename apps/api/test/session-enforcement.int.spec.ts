import {
  AccountSecurityService,
  authorizeConnection,
  buildSignedInitData,
  loadEnv,
  signAccessToken,
  signUserToken,
  type UserAuthService,
} from '@creatorchat/backend-core';
import { TelegramLoginResponseSchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_AUTH } from '../src/common/auth/tokens.js';
import { buildTestApp, type TestApp } from './helpers.js';
import { EnforcementFixturesModule } from './support/enforcement-fixtures.js';

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
let auth: UserAuthService;
let nextTelegramId = 8000;

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
    [EnforcementFixturesModule],
  );
  auth = t.app.get<UserAuthService>(USER_AUTH, { strict: false });
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

async function loginRaw(telegramId: number) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id: telegramId, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
}

async function signIn(telegramId = nextTelegramId++) {
  const res = await loginRaw(telegramId);
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id, telegramId };
}

const get = (url: string, token?: string, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'GET',
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

describe('forged and invalid sessions', () => {
  it('rejects no token, garbage, a wrong-secret token and a token for a deleted session', async () => {
    const { token, userId } = await signIn();
    const forged = await signUserToken(
      'attacker-secret-'.padEnd(48, 'x'),
      { userId, sessionId: '00000000-0000-4000-8000-000000000000', sessionVersion: 1 },
      new Date(),
      600,
    );
    for (const bad of [undefined, 'garbage', `${token}x`, forged]) {
      expect((await get('/v1/me', bad)).statusCode).toBe(401);
    }
    await prisma.session.deleteMany({ where: { userId } });
    expect((await get('/v1/me', token)).statusCode).toBe(401);
  });
});

describe('role declarations', () => {
  it('answers 403 FORBIDDEN_ROLE for the wrong role in both directions and 200 for the right one', async () => {
    const customer = await signIn();
    expect((await get('/v1/_test/user-only', customer.token)).statusCode).toBe(200);
    const asCreator = await get('/v1/_test/creator-only', customer.token);
    expect(asCreator.statusCode).toBe(403);
    expect(asCreator.json().code).toBe('FORBIDDEN_ROLE');

    await security.changeRole(customer.userId, 'CREATOR');
    const creator = await signIn(customer.telegramId);
    expect((await get('/v1/_test/creator-only', creator.token)).statusCode).toBe(200);
    const asUser = await get('/v1/_test/user-only', creator.token);
    expect(asUser.statusCode).toBe(403);
    expect(asUser.json().code).toBe('FORBIDDEN_ROLE');
    // The shared endpoint accepts both roles.
    expect((await get('/v1/me', creator.token)).statusCode).toBe(200);
    expect((await get('/v1/me', customer.token)).statusCode).toBe(401); // old session is dead
  });
});

describe('role change invalidates the old session', () => {
  it('USER → CREATOR: old token loses USER-only access, a fresh login gets the new role', async () => {
    const { token, userId, telegramId } = await signIn();
    expect((await get('/v1/_test/user-only', token)).statusCode).toBe(200);

    await security.changeRole(userId, 'CREATOR');
    expect((await get('/v1/_test/user-only', token)).statusCode).toBe(401);
    expect((await get('/v1/me', token)).statusCode).toBe(401);

    const fresh = await signIn(telegramId);
    expect(fresh.userId).toBe(userId);
    expect((await get('/v1/me', fresh.token)).json().role).toBe('CREATOR');
    expect((await get('/v1/_test/user-only', fresh.token)).statusCode).toBe(403);
  });
});

describe('blocked accounts', () => {
  it('stop working on HTTP and on the connection check, and get no new session', async () => {
    const { token, userId, telegramId } = await signIn();
    expect((await authorizeConnection(auth, token, { roles: ['USER'] })).ok).toBe(true);
    const sessionsBefore = await prisma.session.count();

    await security.blockUser(userId);
    expect((await get('/v1/me', token)).statusCode).toBe(401);
    expect(await authorizeConnection(auth, token, { roles: ['USER'] })).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });

    const relogin = await loginRaw(telegramId);
    expect(relogin.statusCode).toBe(403);
    expect(relogin.json().code).toBe('ACCOUNT_BLOCKED');
    expect(await prisma.session.count()).toBe(sessionsBefore);
  });

  it('unblocking allows a new login but never revives the pre-block session', async () => {
    const { token, userId, telegramId } = await signIn();
    await security.blockUser(userId);
    await security.unblockUser(userId);
    expect((await get('/v1/me', token)).statusCode).toBe(401);
    const fresh = await signIn(telegramId);
    expect((await get('/v1/me', fresh.token)).statusCode).toBe(200);
  });
});

describe('admin and user sessions are not interchangeable', () => {
  it('an admin access token is refused on user routes', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'enf.admin', passwordHash: 'unused' },
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
    for (const url of ['/v1/me', '/v1/_test/user-only', '/v1/creators/by-code/aaaaaaaa']) {
      expect((await get(url, adminToken)).statusCode).toBe(401);
    }
    expect((await authorizeConnection(auth, adminToken, { roles: ['USER'] })).ok).toBe(false);
  });

  it('a user token is refused by the admin API as a cookie and as a Bearer header', async () => {
    const { token } = await signIn();
    const asCookie = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: `cc_admin_at=${token}` },
    });
    expect(asCookie.statusCode).toBe(401);
    expect((await get('/v1/admin/auth/me', token)).statusCode).toBe(401);
  });
});

describe('identity comes from the session only', () => {
  it('ignores user ids, roles and telegram ids sent in query, body or headers', async () => {
    const victim = await signIn();
    const me = await signIn();
    const res = await get(
      `/v1/_test/whoami?user_id=${victim.userId}&role=CREATOR&telegram_id=${victim.telegramId}`,
      me.token,
      {
        'x-user-id': victim.userId,
        'x-role': 'CREATOR',
        'x-telegram-id': String(victim.telegramId),
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: me.userId, role: 'USER' });
    const post = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ user_id: victim.userId, role: 'CREATOR' }),
    });
    expect(post.json().id).toBe(me.userId);
  });
});

describe('IDOR: scoped lookups', () => {
  it("returns the caller's own record and an identical 404 for another user's id or a random id", async () => {
    const a = await signIn();
    const b = await signIn();
    const ownSession = await prisma.session.findFirstOrThrow({ where: { userId: a.userId } });
    const otherSession = await prisma.session.findFirstOrThrow({ where: { userId: b.userId } });

    const own = await get(`/v1/_test/owned/${ownSession.id}`, a.token);
    expect(own.statusCode).toBe(200);

    const bodies: string[] = [];
    for (const id of [otherSession.id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await get(`/v1/_test/owned/${id}`, a.token);
      expect(res.statusCode).toBe(404);
      bodies.push(JSON.stringify({ ...res.json(), request_id: 'x' }));
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
