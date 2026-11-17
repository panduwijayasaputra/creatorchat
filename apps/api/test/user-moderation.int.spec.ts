import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  ErrorResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import { hashPassword, type PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ADMIN_ORIGIN = 'http://localhost:5174';
const USER_ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const PASSWORD = 'a long enough password';
const BASE_PATH = '/v1/admin/users';
const UNKNOWN = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const DAY = 86_400_000;

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 31_000;

interface StoredCookie {
  value: string;
  path: string;
}

/** A tiny browser: keeps the admin cookies and sends the CSRF header like the dashboard will. */
class AdminBrowser {
  jar = new Map<string, StoredCookie>();

  async fetch(
    method: string,
    path: string,
    body?: unknown,
    options: { csrf?: boolean; origin?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { origin: options.origin ?? ADMIN_ORIGIN };
    const cookie = [...this.jar.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([name, c]) => `${name}=${c.value}`)
      .join('; ');
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = this.jar.get(ADMIN_COOKIE.csrf)?.value;
    if (options.csrf !== false && token && method !== 'GET') headers['x-csrf-token'] = token;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const value = pair.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      if (value === '') this.jar.delete(pair.slice(0, eq));
      else this.jar.set(pair.slice(0, eq), { value, path: pathAttr });
    }
    return response;
  }
}

let admin: AdminBrowser;
let adminId = '';

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: process.env.REDIS_URL,
      ALLOWED_ORIGINS: `${USER_ORIGIN},${ADMIN_ORIGIN}`,
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_BOT_USERNAME: 'TestBot',
      USER_SESSION_SECRET: 'user-session-secret-'.padEnd(48, 'u'),
      ADMIN_ACCESS_TOKEN_SECRET: 'access-secret-'.padEnd(48, 'a'),
      ADMIN_REFRESH_TOKEN_SECRET: 'refresh-secret-'.padEnd(48, 'r'),
      COOKIE_SECURE: 'false',
    }),
  );
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  for (const pattern of ['test:admin:login:*', 'test:user:login:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
  adminId = (
    await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: await hashPassword(PASSWORD) },
    })
  ).id;
  admin = new AdminBrowser();
  const login = await admin.fetch(
    'POST',
    '/v1/admin/auth/login',
    { username: 'nadia.admin', password: PASSWORD },
    { csrf: false },
  );
  expect(login.status).toBe(200);
});

async function telegramLogin(id: number, firstName: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: USER_ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: firstName },
        authDate: new Date(),
      }),
    },
  });
  return {
    res,
    body: res.statusCode === 200 ? TelegramLoginResponseSchema.parse(res.json()) : null,
  };
}

/** A real USER account: it signs in through Telegram, so its id and session are real. */
async function makeUser(name = 'Raka Putra') {
  const telegramId = nextTelegramId++;
  const { body } = await telegramLogin(telegramId, name);
  if (!body) throw new Error('login failed');
  return { telegramId, userId: body.user.id, token: body.access_token };
}

const blockPath = (id: string) => `${BASE_PATH}/${id}/block`;
const unblockPath = (id: string) => `${BASE_PATH}/${id}/unblock`;
const REASON = { reason: 'Penyalahgunaan layanan berulang.' };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const me = (token: string) =>
  t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });

describe('block', () => {
  it('revokes the live session, blocks sign-in, audits with the reason and the admin', async () => {
    const u = await makeUser();
    expect((await me(u.token)).statusCode).toBe(200);

    const res = await admin.fetch('POST', blockPath(u.userId), REASON);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ user: { id: u.userId, status: 'BLOCKED' } });

    expect((await me(u.token)).statusCode).toBe(401);
    const again = await telegramLogin(u.telegramId, 'Raka Putra');
    expect(again.res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(again.res.json()).code).toBe('ACCOUNT_BLOCKED');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.account.blocked' },
    });
    expect(audit).toMatchObject({
      actorType: 'ADMIN',
      actorId: adminId,
      targetId: u.userId,
      reason: REASON.reason,
    });
  });

  it('keeps subscriptions and a pending creator request', async () => {
    const u = await makeUser();
    const owner = await prisma.user.create({
      data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa', role: 'CREATOR' },
    });
    const creator = await prisma.creator.create({
      data: { userId: owner.id, publicCode: 'salsa234' },
    });
    await prisma.subscription.create({
      data: {
        customerId: u.userId,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    await prisma.creatorApplication.create({
      data: {
        userId: u.userId,
        creatorName: 'Raka',
        instagramUrl: 'https://instagram.com/raka',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    const before = await prisma.subscription.findMany();
    await admin.fetch('POST', blockPath(u.userId), REASON);
    expect(await prisma.subscription.findMany()).toEqual(before);
    expect((await prisma.creatorApplication.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('400 for an empty reason on both routes, changing nothing', async () => {
    const u = await makeUser();
    for (const body of [{}, { reason: '   ' }]) {
      expect((await admin.fetch('POST', blockPath(u.userId), body)).status).toBe(400);
    }
    expect((await admin.fetch('POST', unblockPath(u.userId), { reason: '' })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).status).toBe(
      'ACTIVE',
    );
    expect(
      await prisma.auditLog.count({ where: { action: { startsWith: 'user.account.b' } } }),
    ).toBe(0);
  });

  it('409 when already blocked; two parallel blocks act once', async () => {
    const u = await makeUser();
    const [a, b] = await Promise.all([
      admin.fetch('POST', blockPath(u.userId), REASON),
      admin.fetch('POST', blockPath(u.userId), REASON),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(ErrorResponseSchema.parse(await loser.json())).toMatchObject({
      code: 'USER_STATUS_CONFLICT',
      details: { status: 'BLOCKED' },
    });
    expect(await prisma.auditLog.count({ where: { action: 'user.account.blocked' } })).toBe(1);
  });

  it('refuses a creator with 409 USER_ROLE_CONFLICT and writes nothing', async () => {
    const c = await prisma.user.create({
      data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa', role: 'CREATOR' },
    });
    for (const path of [blockPath(c.id), unblockPath(c.id)]) {
      const res = await admin.fetch('POST', path, REASON);
      expect(res.status).toBe(409);
      expect(ErrorResponseSchema.parse(await res.json())).toMatchObject({
        code: 'USER_ROLE_CONFLICT',
        details: { role: 'CREATOR' },
      });
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('ACTIVE');
    expect(await prisma.auditLog.count({ where: { targetId: c.id } })).toBe(0);
  });

  it('404 for unknown, malformed, admin and creator-table ids', async () => {
    const u = await makeUser();
    const owner = await prisma.user.create({
      data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa', role: 'CREATOR' },
    });
    const creator = await prisma.creator.create({
      data: { userId: owner.id, publicCode: 'salsa234' },
    });
    for (const id of [UNKNOWN, 'nope', adminId, creator.id]) {
      expect((await admin.fetch('POST', blockPath(id), REASON)).status, id).toBe(404);
      expect((await admin.fetch('POST', unblockPath(id), REASON)).status, id).toBe(404);
      expect((await admin.fetch('GET', `${BASE_PATH}/${id}/block-check`)).status, id).toBe(404);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).status).toBe(
      'ACTIVE',
    );
  });
});

describe('unblock', () => {
  it('lets the user sign in again, changes no subscription, 409 when active', async () => {
    const u = await makeUser();
    expect((await admin.fetch('POST', unblockPath(u.userId), REASON)).status).toBe(409);
    await admin.fetch('POST', blockPath(u.userId), REASON);
    const res = await admin.fetch('POST', unblockPath(u.userId), { reason: 'Banding diterima.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: u.userId, status: 'ACTIVE' } });
    const login = await telegramLogin(u.telegramId, 'Raka Putra');
    expect(login.res.statusCode).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.account.unblocked' },
    });
    expect(audit.reason).toBe('Banding diterima.');
  });
});

describe('block-check and list', () => {
  it('returns the live count and the list reflects the status', async () => {
    const u = await makeUser();
    const owner = await prisma.user.create({
      data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa', role: 'CREATOR' },
    });
    const creator = await prisma.creator.create({
      data: { userId: owner.id, publicCode: 'salsa234' },
    });
    await prisma.subscription.create({
      data: {
        customerId: u.userId,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    const check = await admin.fetch('GET', `${BASE_PATH}/${u.userId}/block-check`);
    expect(check.headers.get('cache-control')).toBe('no-store');
    expect(await check.json()).toMatchObject({
      user_status: 'ACTIVE',
      role: 'USER',
      active_subscriptions: 1,
    });
    await admin.fetch('POST', blockPath(u.userId), REASON);
    const list = (await (await admin.fetch('GET', BASE_PATH)).json()) as {
      items: { id: string; status: string }[];
    };
    expect(list.items.find((i) => i.id === u.userId)?.status).toBe('BLOCKED');
  });
});

describe('authentication', () => {
  it('401/403 without a session, without CSRF and with a Telegram user token; nothing changes', async () => {
    const u = await makeUser();
    const other = await makeUser('Dimas');
    const anon = new AdminBrowser();
    expect([401, 403]).toContain((await anon.fetch('POST', blockPath(u.userId), REASON)).status);
    expect((await anon.fetch('GET', `${BASE_PATH}/${u.userId}/block-check`)).status).toBe(401);
    const viaUser = await t.app.inject({
      method: 'POST',
      url: blockPath(u.userId),
      headers: { ...bearer(other.token), origin: ADMIN_ORIGIN },
      payload: REASON,
    });
    expect([401, 403]).toContain(viaUser.statusCode);
    const noCsrf = await admin.fetch('POST', blockPath(u.userId), REASON, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).status).toBe(
      'ACTIVE',
    );
  });
});
