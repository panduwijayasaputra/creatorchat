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
const BASE_PATH = '/v1/admin/creators';
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
  expect(res.statusCode).toBe(200);
  return TelegramLoginResponseSchema.parse(res.json());
}

/** A creator row for a Telegram id; the creator then signs in through the real login. */
async function makeCreator(code = 'salsa234') {
  const telegramId = nextTelegramId++;
  const user = await prisma.user.create({
    data: { telegramId: BigInt(telegramId), displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({ data: { userId: user.id, publicCode: code } });
  return { telegramId, userId: user.id, creatorId: creator.id, code };
}

const blockPath = (id: string) => `${BASE_PATH}/${id}/block`;
const unblockPath = (id: string) => `${BASE_PATH}/${id}/unblock`;
const REASON = { reason: 'Pelanggaran ketentuan konten.' };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const byCode = (code: string, token: string) =>
  t.app.inject({ method: 'GET', url: `/v1/creators/by-code/${code}`, headers: bearer(token) });

describe('block', () => {
  it('revokes the live session, blocks login, hides the deep link, audits with the reason', async () => {
    const c = await makeCreator();
    const creatorLogin = await telegramLogin(c.telegramId, 'Salsa');
    const customer = await telegramLogin(nextTelegramId++, 'Raka');
    expect((await byCode(c.code, customer.access_token)).statusCode).toBe(200);
    const unknown = await byCode('zzzzzzzz', customer.access_token);

    const res = await admin.fetch('POST', blockPath(c.creatorId), REASON);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      creator: { id: c.creatorId, status: 'BLOCKED' },
      active_subscribers: 0,
    });

    const me = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(creatorLogin.access_token),
    });
    expect(me.statusCode).toBe(401);
    const relogin = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/telegram',
      headers: { origin: USER_ORIGIN },
      payload: {
        init_data: buildSignedInitData({
          botToken: BOT,
          user: { id: c.telegramId, first_name: 'Salsa' },
          authDate: new Date(),
        }),
      },
    });
    expect(relogin.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(relogin.json()).code).toBe('ACCOUNT_BLOCKED');

    const hidden = await byCode(c.code, customer.access_token);
    expect(hidden.statusCode).toBe(404);
    expect({ ...hidden.json(), request_id: '' }).toEqual({ ...unknown.json(), request_id: '' });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'creator.blocked' } });
    expect(audit).toMatchObject({ actorId: adminId, targetId: c.creatorId, reason: REASON.reason });
  });

  it('keeps history: subscriptions and the creator row stay', async () => {
    const c = await makeCreator();
    const customer = await prisma.user.create({
      data: { telegramId: BigInt(nextTelegramId++), displayName: 'Raka' },
    });
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: c.creatorId,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    await admin.fetch('POST', blockPath(c.creatorId), REASON);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.creator.count()).toBe(1);
  });

  it('400 for an empty reason on both routes, changing nothing', async () => {
    const c = await makeCreator();
    for (const body of [{}, { reason: '   ' }]) {
      expect((await admin.fetch('POST', blockPath(c.creatorId), body)).status).toBe(400);
    }
    expect((await admin.fetch('POST', unblockPath(c.creatorId), { reason: '' })).status).toBe(400);
    expect((await prisma.creator.findUniqueOrThrow({ where: { id: c.creatorId } })).status).toBe(
      'ACTIVE',
    );
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'creator.' } } })).toBe(0);
  });

  it('409 when already blocked; two parallel blocks act once', async () => {
    const c = await makeCreator();
    const [a, b] = await Promise.all([
      admin.fetch('POST', blockPath(c.creatorId), REASON),
      admin.fetch('POST', blockPath(c.creatorId), REASON),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const body = ErrorResponseSchema.parse(await loser.json());
    expect(body).toMatchObject({ code: 'CREATOR_STATUS_CONFLICT', details: { status: 'BLOCKED' } });
    expect(await prisma.auditLog.count({ where: { action: 'creator.blocked' } })).toBe(1);
  });

  it('404 for unknown, malformed and user ids', async () => {
    const c = await makeCreator();
    for (const id of [UNKNOWN, 'nope', c.userId]) {
      expect((await admin.fetch('POST', blockPath(id), REASON)).status).toBe(404);
      expect((await admin.fetch('GET', `${BASE_PATH}/${id}/block-check`)).status).toBe(404);
    }
  });
});

describe('unblock', () => {
  it('reverses status only: deep link works again, subscription untouched, 409 when active', async () => {
    const c = await makeCreator();
    const customer = await telegramLogin(nextTelegramId++, 'Raka');
    expect((await admin.fetch('POST', unblockPath(c.creatorId), REASON)).status).toBe(409);
    await admin.fetch('POST', blockPath(c.creatorId), REASON);
    const res = await admin.fetch('POST', unblockPath(c.creatorId), {
      reason: 'Banding diterima.',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ creator: { id: c.creatorId, status: 'ACTIVE' } });
    expect((await byCode(c.code, customer.access_token)).statusCode).toBe(200);
    expect(await prisma.subscription.count()).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'creator.unblocked' },
    });
    expect(audit.reason).toBe('Banding diterima.');
  });
});

describe('block-check and list', () => {
  it('returns the live count and the list reflects the status', async () => {
    const c = await makeCreator();
    const customer = await prisma.user.create({
      data: { telegramId: BigInt(nextTelegramId++), displayName: 'Raka' },
    });
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: c.creatorId,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    const check = await admin.fetch('GET', `${BASE_PATH}/${c.creatorId}/block-check`);
    expect(check.headers.get('cache-control')).toBe('no-store');
    expect(await check.json()).toMatchObject({ creator_status: 'ACTIVE', active_subscribers: 1 });
    await admin.fetch('POST', blockPath(c.creatorId), REASON);
    const list = (await (await admin.fetch('GET', BASE_PATH)).json()) as {
      items: { id: string; status: string }[];
    };
    expect(list.items.find((i) => i.id === c.creatorId)?.status).toBe('BLOCKED');
  });
});

describe('authentication', () => {
  it('401/403 without a session, without CSRF and with a Telegram user token; nothing changes', async () => {
    const c = await makeCreator();
    const user = await telegramLogin(nextTelegramId++, 'Raka');
    const anon = new AdminBrowser();
    expect([401, 403]).toContain((await anon.fetch('POST', blockPath(c.creatorId), REASON)).status);
    expect((await anon.fetch('GET', `${BASE_PATH}/${c.creatorId}/block-check`)).status).toBe(401);
    const viaUser = await t.app.inject({
      method: 'POST',
      url: blockPath(c.creatorId),
      headers: { ...bearer(user.access_token), origin: ADMIN_ORIGIN },
      payload: REASON,
    });
    expect([401, 403]).toContain(viaUser.statusCode);
    const noCsrf = await admin.fetch('POST', blockPath(c.creatorId), REASON, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect((await prisma.creator.findUniqueOrThrow({ where: { id: c.creatorId } })).status).toBe(
      'ACTIVE',
    );
  });
});
