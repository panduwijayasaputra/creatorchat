import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  UserListResponseSchema,
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

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;

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
  await prisma.adminAccount.create({
    data: { username: 'nadia.admin', passwordHash: await hashPassword(PASSWORD) },
  });
  admin = new AdminBrowser();
  const login = await admin.fetch(
    'POST',
    '/v1/admin/auth/login',
    { username: 'nadia.admin', password: PASSWORD },
    { csrf: false },
  );
  expect(login.status).toBe(200);
});

async function telegramToken(id: number) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: USER_ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  return TelegramLoginResponseSchema.parse(res.json()).access_token;
}

async function seed() {
  let n = 0;
  const mk = (name: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { telegramId: BigInt(900_000 + n++), displayName: name, ...data } });
  const apply = (userId: string, status: 'PENDING' | 'REJECTED') =>
    prisma.creatorApplication.create({
      data: {
        userId,
        creatorName: 'X',
        instagramUrl: 'https://instagram.com/x',
        creatorType: 'HUMAN',
        description: 'Deskripsi rahasia admin',
        status,
        ...(status === 'REJECTED'
          ? { reviewedAt: new Date(), reviewReason: 'Alasan rahasia' }
          : {}),
      },
    });
  await apply((await mk('Maya Lestari')).id, 'PENDING');
  await apply((await mk('Luna Aurora')).id, 'REJECTED');
  for (let i = 0; i < 11; i += 1) {
    await mk(`User ${String(i).padStart(2, '0')}`, { status: i % 4 === 0 ? 'BLOCKED' : 'ACTIVE' });
  }
  // CREATORs must never show up.
  for (let i = 0; i < 3; i += 1) {
    const u = await mk(`Creator ${i}`, { role: 'CREATOR' });
    await prisma.creator.create({ data: { userId: u.id, publicCode: `ab${'cde'[i]}bbbbb` } });
  }
}

const get = async (query = '') => {
  const res = await admin.fetch('GET', `${BASE_PATH}${query}`);
  return { res, body: (await res.json()) as unknown };
};
const ids = async (query: string) =>
  UserListResponseSchema.parse((await get(query)).body).items.map((i) => i.id);

describe('GET /v1/admin/users', () => {
  it('answers an admin with the contract shape and no-store; creators never appear', async () => {
    await seed();
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const parsed = UserListResponseSchema.parse(body);
    expect(parsed).toMatchObject({ total: 13, page: 1, page_size: 10 });
    expect(parsed.items).toHaveLength(10);
    expect(JSON.stringify(await get('?page_size=50'))).not.toContain('Creator 0');
  });

  it('refuses no session and a Telegram user token (401)', async () => {
    await seed();
    expect((await new AdminBrowser().fetch('GET', BASE_PATH)).status).toBe(401);
    const token = await telegramToken(555);
    const res = await fetch(`${base}${BASE_PATH}`, {
      headers: { origin: ADMIN_ORIGIN, authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    expect(ErrorResponseSchema.safeParse(await res.json()).success).toBe(true);
  });

  it('filters, sort and pagination change the backend result', async () => {
    await seed();
    const all = await ids('?page_size=50&sort=name&dir=asc');
    expect(all).toHaveLength(13);
    expect(await ids('?page_size=50&sort=name&dir=desc')).toEqual([...all].reverse());
    expect(await ids('?status=blocked')).toHaveLength(3);
    expect(await ids('?request=pending')).toHaveLength(1);
    expect(await ids('?request=rejected')).toHaveLength(1);
    expect(await ids('?request=none&page_size=50')).toHaveLength(11);
    expect(await ids('?q=luna')).toHaveLength(1);
    expect(await ids('?range=7d&page_size=50')).toHaveLength(13);
    const p1 = await ids('?sort=name&dir=asc&page=1&page_size=10');
    const p2 = await ids('?sort=name&dir=asc&page=2&page_size=10');
    expect([...p1, ...p2]).toEqual(all);
    expect(await ids('?page=5')).toEqual([]);
  });

  it('refuses every unknown sort, filter, page size or key with a 400', async () => {
    await seed();
    for (const bad of [
      'sort=password',
      'sort=type',
      'dir=sideways',
      'status=request',
      'status=',
      'request=approved',
      'request=',
      'range=1y',
      'page_size=20',
      'page=0',
      'page=abc',
      'extra=1',
      'status=active&status=blocked',
      `q=${'a'.repeat(101)}`,
    ]) {
      const { res, body } = await get(`?${bad}`);
      expect(res.status, bad).toBe(400);
      expect(ErrorResponseSchema.parse(body).code).toBe('VALIDATION_FAILED');
    }
  });

  it('returns no private data', async () => {
    await seed();
    const { body } = await get('?page_size=50');
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/rahasia|review_reason|description|reviewed_by|session|message/);
    expect(UserListResponseSchema.safeParse(body).success).toBe(true);
  });

  it('never writes', async () => {
    await seed();
    const counts = async () => [
      await prisma.user.count(),
      await prisma.creatorApplication.count(),
      await prisma.creator.count(),
      await prisma.auditLog.count(),
      await prisma.outboxEvent.count(),
    ];
    const before = await counts();
    await get('?page_size=50');
    await get('?q=maya&sort=date');
    expect(await counts()).toEqual(before);
  });
});
