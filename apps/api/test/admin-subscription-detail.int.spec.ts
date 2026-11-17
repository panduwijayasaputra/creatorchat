import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  SubscriptionDetailResponseSchema,
  SubscriptionEventsResponseSchema,
  CreatorSubscribersResponseSchema,
  GrantableUsersResponseSchema,
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
const CREATORS = '/v1/admin/creators';

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

let tgn = 930_000;
let codeN = 0;
const mk = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: BigInt(tgn++), displayName: name, ...data } });
const mkCreator = async (name: string, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') => {
  const u = await mk(name, { role: 'CREATOR' });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `api${'abcdefgh'[codeN++ % 8]}${'abcdefgh'[Math.floor(codeN / 8) % 8]}bbb`.slice(
        0,
        8,
      ),
      status,
    },
  });
  return { u, c };
};

async function seed() {
  const adminRow = await prisma.adminAccount.findFirstOrThrow();
  const raka = await mk('Raka Putra', { telegramUsername: 'rakaputra' });
  const other = await mk('Other');
  const salsa = await mkCreator('Salsa');
  const kirana = await mkCreator('Kirana');
  const now = Date.now();
  const sub = await prisma.subscription.create({
    data: {
      customerId: raka.id,
      creatorId: salsa.c.id,
      startsAt: new Date(now - 18 * 86_400_000),
      endsAt: new Date(now + 12 * 86_400_000),
    },
  });
  const audit = await prisma.auditLog.create({
    data: {
      actorType: 'ADMIN',
      actorId: adminRow.id,
      action: 'subscription.granted',
      targetType: 'subscription',
      targetId: sub.id,
      reason: 'alasan rahasia',
    },
  });
  await prisma.subscriptionEvent.createMany({
    data: [
      {
        subscriptionId: sub.id,
        adminId: adminRow.id,
        type: 'GRANT' as const,
        reason: 'alasan rahasia',
        auditLogId: audit.id,
        startsAt: sub.startsAt,
        newEndsAt: sub.endsAt,
        createdAt: new Date(now - 18 * 86_400_000),
      },
      {
        subscriptionId: sub.id,
        adminId: adminRow.id,
        type: 'EXTEND' as const,
        reason: 'alasan rahasia',
        previousEndsAt: new Date(now + 2 * 86_400_000),
        newEndsAt: sub.endsAt,
        createdAt: new Date(now - 3 * 86_400_000),
      },
    ],
  });
  const otherSub = await prisma.subscription.create({
    data: {
      customerId: other.id,
      creatorId: kirana.c.id,
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 5 * 86_400_000),
    },
  });
  const pendingUser = await mk('Pending');
  const pendingApp = await prisma.creatorApplication.create({
    data: {
      userId: pendingUser.id,
      creatorName: 'P',
      instagramUrl: 'https://instagram.com/p',
      creatorType: 'HUMAN',
      description: 'd',
    },
  });
  return { raka, other, salsa, kirana, sub, otherSub, audit, adminRow, pendingApp, pendingUser };
}

const get = async (path: string) => {
  const res = await admin.fetch('GET', path);
  return { res, body: (await res.json()) as unknown };
};

describe('subscription detail and events', () => {
  it('answers the owner with the contract shape, no-store and no private data', async () => {
    const s = await seed();
    const d = await get(`${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}`);
    expect(d.res.status).toBe(200);
    expect(d.res.headers.get('cache-control')).toBe('no-store');
    expect(SubscriptionDetailResponseSchema.parse(d.body)).toMatchObject({
      subscription: { status: 'ACTIVE', source: 'ADMIN', created_by_label: 'nadia.admin' },
      customer: { display_name: 'Raka Putra' },
      creator: { display_name: 'Salsa' },
    });
    const e = await get(`${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}/events`);
    const parsed = SubscriptionEventsResponseSchema.parse(e.body);
    expect(parsed.total).toBe(2);
    expect(parsed.items.map((i) => i.action)).toEqual(['Perpanjang akses', 'Berikan akses']);
    expect(parsed.items[1]?.log_id).toBe(s.audit.id);
    expect(JSON.stringify([d.body, e.body])).not.toMatch(
      new RegExp(`alasan rahasia|${s.adminRow.id}|payment|session_version`),
    );
  });

  it('events paging and sort change the result; 400 on every bad value', async () => {
    const s = await seed();
    const path = `${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}/events`;
    const ids = async (q: string) =>
      SubscriptionEventsResponseSchema.parse((await get(`${path}${q}`)).body).items.map(
        (i) => i.id,
      );
    const desc = await ids('');
    expect(await ids('?dir=asc')).toEqual([...desc].reverse());
    expect(await ids('?page=2')).toEqual([]);
    expect((await ids('?page_size=25&sort=actor')).length).toBe(2);
    for (const bad of [
      'sort=reason',
      'dir=up',
      'page_size=20',
      'page=0',
      'extra=1',
      'sort=time&sort=actor',
    ]) {
      const r = await get(`${path}?${bad}`);
      expect(r.res.status, bad).toBe(400);
      expect(ErrorResponseSchema.parse(r.body).code).toBe('VALIDATION_FAILED');
    }
  });

  it("another user's subscription, a creator id, an admin id, unknown and malformed ids are one identical 404", async () => {
    const s = await seed();
    const messages = new Set<string>();
    for (const path of [
      `${BASE_PATH}/${s.raka.id}/subscriptions/${s.otherSub.id}`,
      `${BASE_PATH}/${s.other.id}/subscriptions/${s.sub.id}`,
      `${BASE_PATH}/${s.salsa.u.id}/subscriptions/${s.sub.id}`,
      `${BASE_PATH}/${s.adminRow.id}/subscriptions/${s.sub.id}`,
      `${BASE_PATH}/${s.raka.id}/subscriptions/0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33`,
      `${BASE_PATH}/${s.raka.id}/subscriptions/nope`,
      `${BASE_PATH}/${s.other.id}/subscriptions/${s.sub.id}/events`,
      `${BASE_PATH}/${s.raka.id}/subscriptions/${s.otherSub.id}/events`,
    ]) {
      const r = await get(path);
      expect(r.res.status, path).toBe(404);
      messages.add(ErrorResponseSchema.parse(r.body).message);
    }
    expect(messages.size).toBe(1);
  });
});

describe('creator subscribers and the picker', () => {
  it('lists only this creator; filters, sort and pages change the backend result', async () => {
    const s = await seed();
    for (let i = 0; i < 11; i += 1) {
      const u = await mk(`Fan ${String(i).padStart(2, '0')}`);
      await prisma.subscription.create({
        data: {
          customerId: u.id,
          creatorId: s.salsa.c.id,
          startsAt: new Date(Date.now() - 40 * 86_400_000),
          endsAt: new Date(Date.now() + (i < 3 ? -1 : 9) * 86_400_000),
        },
      });
    }
    const rows = async (q = '') =>
      CreatorSubscribersResponseSchema.parse(
        (await get(`${CREATORS}/${s.salsa.c.id}/subscribers${q}`)).body,
      );
    expect((await rows()).total).toBe(12);
    expect((await rows('?page=2')).items).toHaveLength(2);
    expect((await rows('?status=expired')).total).toBe(3);
    expect((await rows('?status=active')).total).toBe(9);
    expect((await rows('?q=raka')).total).toBe(1);
    expect((await rows('?q=fan%2003')).total).toBe(1);
    const asc = (await rows('?sort=subscriber&dir=asc&page_size=50')).items.map(
      (i) => i.customer.display_name,
    );
    expect(asc).toEqual([...asc].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect((await rows('?page=9')).items).toEqual([]);
    for (const bad of [
      'sort=creator',
      'status=gone',
      'ends=never',
      'dir=up',
      'page_size=20',
      'page=0',
      'extra=1',
      `q=${'a'.repeat(101)}`,
    ]) {
      const r = await get(`${CREATORS}/${s.salsa.c.id}/subscribers?${bad}`);
      expect(r.res.status, bad).toBe(400);
    }
    expect(JSON.stringify(await rows())).not.toMatch(/session_version|alasan|reason/);
  });

  it('a pending request id, a user id and unknown ids are one identical 404', async () => {
    const s = await seed();
    const messages = new Set<string>();
    for (const id of [
      s.pendingApp.id,
      s.pendingUser.id,
      '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
      'nope',
    ]) {
      for (const tail of ['subscribers', 'grantable-users']) {
        const r = await get(`${CREATORS}/${id}/${tail}`);
        expect(r.res.status, `${id}/${tail}`).toBe(404);
        messages.add(ErrorResponseSchema.parse(r.body).message);
      }
    }
    expect(messages.size).toBe(1);
  });

  it('grantable users: excludes entitled users, honours q, capped; a blocked creator says why', async () => {
    const s = await seed();
    const users = async (q = '') =>
      GrantableUsersResponseSchema.parse(
        (await get(`${CREATORS}/${s.salsa.c.id}/grantable-users${q}`)).body,
      );
    const names = (await users()).items.map((i) => i.display_name);
    expect(names).not.toContain('Raka Putra');
    expect(names).toContain('Other');
    expect((await users('?q=other')).items).toHaveLength(1);
    expect((await get(`${CREATORS}/${s.salsa.c.id}/grantable-users?extra=1`)).res.status).toBe(400);
    const blocked = await mkCreator('Citra', 'BLOCKED');
    expect(
      GrantableUsersResponseSchema.parse(
        (await get(`${CREATORS}/${blocked.c.id}/grantable-users`)).body,
      ),
    ).toEqual({ creator_status: 'BLOCKED', items: [] });
  });

  it('reflects a grant, an extend and a revoke made through the US-020 endpoints', async () => {
    const s = await seed();
    const fan = await mk('New Fan');
    const post = (path: string, body: unknown) => admin.fetch('POST', path, body);
    const granted = await post(`${BASE_PATH}/${fan.id}/subscriptions`, {
      creator_id: s.salsa.c.id,
      duration_days: 30,
      reason: 'Uji coba',
    });
    expect(granted.status).toBe(201);
    const list = async () =>
      CreatorSubscribersResponseSchema.parse(
        (await get(`${CREATORS}/${s.salsa.c.id}/subscribers?q=new%20fan`)).body,
      );
    const row = (await list()).items[0]!;
    expect(row).toMatchObject({ status: 'ACTIVE', customer: { id: fan.id } });
    expect(
      (
        await post(`${BASE_PATH}/${row.customer.id}/subscriptions/${row.id}/extend`, {
          duration_days: 7,
          reason: 'Tambah',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`${BASE_PATH}/${row.customer.id}/subscriptions/${row.id}/revoke`, {
          reason: 'Cabut',
        })
      ).status,
    ).toBe(200);
    expect((await list()).items[0]?.status).toBe('REVOKED');
    const events = SubscriptionEventsResponseSchema.parse(
      (await get(`${BASE_PATH}/${fan.id}/subscriptions/${row.id}/events`)).body,
    );
    expect(events.items.map((i) => i.action)).toEqual([
      'Cabut akses',
      'Perpanjang akses',
      'Berikan akses',
    ]);
    expect(events.items.every((i) => i.log_id !== null)).toBe(true);
    expect(
      GrantableUsersResponseSchema.parse(
        (await get(`${CREATORS}/${s.salsa.c.id}/grantable-users?q=new%20fan`)).body,
      ).items,
    ).toHaveLength(1);
  });
});

describe('auth and writes', () => {
  it('refuses no session and a Telegram user token (401) on all four routes', async () => {
    const s = await seed();
    const token = await telegramToken(555);
    for (const path of [
      `${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}`,
      `${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}/events`,
      `${CREATORS}/${s.salsa.c.id}/subscribers`,
      `${CREATORS}/${s.salsa.c.id}/grantable-users`,
    ]) {
      expect((await new AdminBrowser().fetch('GET', path)).status, path).toBe(401);
      const res = await fetch(`${base}${path}`, {
        headers: { origin: ADMIN_ORIGIN, authorization: `Bearer ${token}` },
      });
      expect(res.status, path).toBe(401);
    }
  });

  it('the read endpoints never write', async () => {
    const s = await seed();
    const counts = async () => [
      await prisma.user.count(),
      await prisma.subscription.count(),
      await prisma.subscriptionEvent.count(),
      await prisma.auditLog.count(),
      await prisma.outboxEvent.count(),
      await prisma.conversation.count(),
    ];
    const before = await counts();
    for (const path of [
      `${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}`,
      `${BASE_PATH}/${s.raka.id}/subscriptions/${s.sub.id}/events`,
      `${CREATORS}/${s.salsa.c.id}/subscribers`,
      `${CREATORS}/${s.salsa.c.id}/grantable-users?q=a`,
    ])
      await get(path);
    expect(await counts()).toEqual(before);
  });
});
