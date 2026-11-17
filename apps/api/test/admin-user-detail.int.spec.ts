import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  UserDetailResponseSchema,
  UserRequestDetailSchema,
  UserRequestsResponseSchema,
  HistoryResponseSchema,
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

let tgn = 920_000;
const mk = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: BigInt(tgn++), displayName: name, ...data } });
const apply = async (userId: string, status: 'PENDING' | 'REJECTED') =>
  prisma.creatorApplication.create({
    data: {
      userId,
      creatorName: 'X',
      instagramUrl: 'https://instagram.com/x',
      creatorType: 'HUMAN',
      description: 'Deskripsi rahasia admin',
      status,
      // Distinct times: the ordinal is ranked by created_at, so two rows made in the same
      // millisecond would fall back to their random ids and swap places.
      createdAt: new Date(Date.now() - (status === 'REJECTED' ? 120_000 : 60_000)),
      ...(status === 'REJECTED'
        ? {
            reviewedAt: new Date(),
            reviewReason: 'Alasan penolakan',
            reviewedByAdminId: (await prisma.adminAccount.findFirstOrThrow()).id,
          }
        : {}),
    },
  });

async function seed() {
  const raka = await mk('Raka Putra', { bio: 'Halo' });
  const rejected = await apply(raka.id, 'REJECTED');
  const pending = await apply(raka.id, 'PENDING');
  const other = await mk('Other');
  const otherApp = await apply(other.id, 'PENDING');
  const cu = await mk('Salsa', { role: 'CREATOR' });
  const creator = await prisma.creator.create({ data: { userId: cu.id, publicCode: 'abcbbbbb' } });
  const admin = await prisma.adminAccount.findFirstOrThrow();
  const entry = await prisma.auditLog.create({
    data: {
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'creator.application.rejected',
      targetType: 'creator_application',
      targetId: rejected.id,
    },
  });
  await prisma.auditLog.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      actorType: 'SYSTEM' as const,
      action: 'creator.application.submitted',
      targetType: 'creator_application',
      targetId: pending.id,
      createdAt: new Date(Date.now() - i * 60000),
    })),
  });
  return { raka, rejected, pending, other, otherApp, cu, creator, entry, admin };
}

const get = async (path: string) => {
  const res = await admin.fetch('GET', path);
  return { res, body: (await res.json()) as unknown };
};

describe('GET /v1/admin/users/:id', () => {
  it('answers a user with the contract shape and no-store', async () => {
    const s = await seed();
    const { res, body } = await get(`${BASE_PATH}/${s.raka.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(UserDetailResponseSchema.parse(body)).toMatchObject({
      role: 'USER',
      user: { display_name: 'Raka Putra' },
      creator_request: { status: 'PENDING', rejection_count: 1, latest_request_id: s.pending.id },
    });
  });

  it('a creator id answers only the creator id; admin, unknown and malformed ids are one 404', async () => {
    const s = await seed();
    const { body } = await get(`${BASE_PATH}/${s.cu.id}`);
    expect(UserDetailResponseSchema.parse(body)).toEqual({
      role: 'CREATOR',
      creator_id: s.creator.id,
    });
    const messages = new Set<string>();
    for (const id of [s.admin.id, '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33', 'nope']) {
      const r = await get(`${BASE_PATH}/${id}`);
      expect(r.res.status, id).toBe(404);
      messages.add(ErrorResponseSchema.parse(r.body).message);
    }
    expect(messages.size).toBe(1);
  });

  it('refuses no session and a Telegram user token (401) on all four routes', async () => {
    const s = await seed();
    const token = await telegramToken(555);
    for (const path of [
      `${BASE_PATH}/${s.raka.id}`,
      `${BASE_PATH}/${s.raka.id}/requests`,
      `${BASE_PATH}/${s.raka.id}/requests/${s.pending.id}`,
      `${BASE_PATH}/${s.raka.id}/history`,
    ]) {
      expect((await new AdminBrowser().fetch('GET', path)).status, path).toBe(401);
      const res = await fetch(`${base}${path}`, {
        headers: { origin: ADMIN_ORIGIN, authorization: `Bearer ${token}` },
      });
      expect(res.status, path).toBe(401);
    }
  });
});

describe('GET /v1/admin/users/:id/requests', () => {
  it('filters, sort and pages change the backend result; 400 on every bad value', async () => {
    const s = await seed();
    const rows = async (q = '') =>
      UserRequestsResponseSchema.parse((await get(`${BASE_PATH}/${s.raka.id}/requests${q}`)).body);
    expect((await rows()).total).toBe(2);
    expect((await rows('?status=rejected')).items.map((i) => i.ordinal)).toEqual([1]);
    expect((await rows('?status=pending')).items.map((i) => i.ordinal)).toEqual([2]);
    expect((await rows('?q=penolakan')).total).toBe(1);
    expect((await rows('?dir=asc')).items.map((i) => i.ordinal)).toEqual([1, 2]);
    expect((await rows('?page=3')).items).toEqual([]);
    expect((await rows()).pending?.id).toBe(s.pending.id);
    for (const bad of [
      'sort=secret',
      'dir=up',
      'status=approved',
      'page_size=20',
      'page=0',
      'extra=1',
      'status=all&status=pending',
    ]) {
      const r = await get(`${BASE_PATH}/${s.raka.id}/requests?${bad}`);
      expect(r.res.status, bad).toBe(400);
      expect(ErrorResponseSchema.parse(r.body).code).toBe('VALIDATION_FAILED');
    }
    expect((await get(`${BASE_PATH}/${s.cu.id}/requests`)).res.status).toBe(404);
  });
});

describe('GET /v1/admin/users/:id/requests/:requestId', () => {
  it('answers an owned pending and rejected request', async () => {
    const s = await seed();
    const p = UserRequestDetailSchema.parse(
      (await get(`${BASE_PATH}/${s.raka.id}/requests/${s.pending.id}`)).body,
    );
    expect(p).toMatchObject({ request: { status: 'PENDING', ordinal: 2 }, review: null });
    const r = UserRequestDetailSchema.parse(
      (await get(`${BASE_PATH}/${s.raka.id}/requests/${s.rejected.id}`)).body,
    );
    expect(r).toMatchObject({
      request: { ordinal: 1 },
      review: { reason: 'Alasan penolakan', reviewer_label: 'nadia.admin', log_id: s.entry.id },
    });
    expect(JSON.stringify(r)).not.toContain(s.admin.id);
  });

  it("another user's request and unknown ids are the same 404", async () => {
    const s = await seed();
    const messages = new Set<string>();
    for (const path of [
      `${BASE_PATH}/${s.raka.id}/requests/${s.otherApp.id}`,
      `${BASE_PATH}/${s.other.id}/requests/${s.pending.id}`,
      `${BASE_PATH}/${s.cu.id}/requests/${s.pending.id}`,
      `${BASE_PATH}/${s.raka.id}/requests/0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33`,
      `${BASE_PATH}/${s.raka.id}/requests/nope`,
    ]) {
      const r = await get(path);
      expect(r.res.status, path).toBe(404);
      messages.add(ErrorResponseSchema.parse(r.body).message);
    }
    expect(messages.size).toBe(1);
  });
});

describe('GET /v1/admin/users/:id/history', () => {
  it('lists this user events, pages and filters, and refuses bad values', async () => {
    const s = await seed();
    const rows = async (q = '') =>
      HistoryResponseSchema.parse((await get(`${BASE_PATH}/${s.raka.id}/history${q}`)).body);
    expect((await rows()).total).toBe(13);
    expect((await rows('?page=2')).items).toHaveLength(3);
    expect((await rows('?q=tolak')).total).toBe(1);
    expect((await rows('?status=failed')).total).toBe(0);
    for (const bad of ['sort=password', 'type=chat', 'status=maybe', 'page_size=20', 'extra=1']) {
      expect((await get(`${BASE_PATH}/${s.raka.id}/history?${bad}`)).res.status, bad).toBe(400);
    }
    expect((await get(`${BASE_PATH}/${s.cu.id}/history`)).res.status).toBe(404);
    const other = await rows();
    expect(other.items.every((i) => i.actor !== 'Other')).toBe(true);
  });
});

describe('private data and writes', () => {
  it('returns no private data and never writes', async () => {
    const s = await seed();
    const counts = async () => [
      await prisma.user.count(),
      await prisma.creatorApplication.count(),
      await prisma.creator.count(),
      await prisma.auditLog.count(),
      await prisma.outboxEvent.count(),
    ];
    const before = await counts();
    const all = JSON.stringify([
      (await get(`${BASE_PATH}/${s.raka.id}`)).body,
      (await get(`${BASE_PATH}/${s.raka.id}/requests`)).body,
      (await get(`${BASE_PATH}/${s.raka.id}/history?page_size=50`)).body,
    ]);
    expect(all).not.toMatch(/Deskripsi rahasia|session_version|reviewed_by|message"/);
    expect(await counts()).toEqual(before);
  });
});
