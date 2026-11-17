import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  CreatorDetailResponseSchema,
  HistoryResponseSchema,
  AuditLogDetailSchema,
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

let tgn = 910_000;
const mk = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: BigInt(tgn++), displayName: name, ...data } });
const apply = (userId: string, status: 'PENDING' | 'REJECTED' | 'APPROVED') =>
  prisma.creatorApplication.create({
    data: {
      userId,
      creatorName: 'X',
      instagramUrl: 'https://instagram.com/x',
      creatorType: 'HUMAN',
      description: 'Deskripsi rahasia admin',
      status,
      ...(status !== 'PENDING'
        ? {
            reviewedAt: new Date(),
            ...(status === 'REJECTED' ? { reviewReason: 'Alasan rahasia' } : {}),
          }
        : {}),
    },
  });

async function seed() {
  const maya = await mk('Maya Lestari');
  const pending = await apply(maya.id, 'PENDING');
  const luna = await mk('Luna Aurora');
  const rejected = await apply(luna.id, 'REJECTED');
  const cu = await mk('Salsa', { role: 'CREATOR' });
  const creator = await prisma.creator.create({ data: { userId: cu.id, publicCode: 'abcbbbbb' } });
  const approved = await apply(cu.id, 'APPROVED');
  const bu = await mk('Citra', { role: 'CREATOR' });
  const blocked = await prisma.creator.create({
    data: { userId: bu.id, publicCode: 'abdbbbbb', status: 'BLOCKED' },
  });
  const entry = await prisma.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      action: 'creator.blocked',
      targetType: 'creator',
      targetId: blocked.id,
      reason: 'Pelanggaran',
      requestId: 'req_1',
      changes: {
        password: 'hunter2',
        token: 'tok',
        status: ['ACTIVE', 'BLOCKED'],
        active_subscribers: 4,
      } as never,
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
  return { pending, rejected, creator, approved, blocked, user: maya, entry };
}

const get = async (path: string) => {
  const res = await admin.fetch('GET', path);
  return { res, body: (await res.json()) as unknown };
};

describe('GET /v1/admin/creators/:id', () => {
  it('answers a pending request, an active and a blocked creator with the contract shape', async () => {
    const s = await seed();
    for (const [id, kind, status] of [
      [s.pending.id, 'request', 'REQUEST'],
      [s.creator.id, 'creator', 'ACTIVE'],
      [s.blocked.id, 'creator', 'BLOCKED'],
    ] as const) {
      const { res, body } = await get(`${BASE_PATH}/${id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(CreatorDetailResponseSchema.parse(body).detail).toMatchObject({ kind, status, id });
    }
  });

  it('an approved application id answers with the creator canonical id', async () => {
    const s = await seed();
    const { body } = await get(`${BASE_PATH}/${s.approved.id}`);
    expect(CreatorDetailResponseSchema.parse(body).detail.id).toBe(s.creator.id);
  });

  it('rejected application, user id, unknown and malformed ids are one identical 404', async () => {
    const s = await seed();
    const bodies = new Set<string>();
    for (const id of [s.rejected.id, s.user.id, '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33', 'nope']) {
      const { res, body } = await get(`${BASE_PATH}/${id}`);
      expect(res.status, id).toBe(404);
      const parsed = ErrorResponseSchema.parse(body);
      bodies.add(parsed.message);
    }
    expect(bodies.size).toBe(1);
  });

  it('refuses no session and a Telegram user token (401) on all three routes', async () => {
    const s = await seed();
    const token = await telegramToken(555);
    for (const path of [
      `${BASE_PATH}/${s.pending.id}`,
      `${BASE_PATH}/${s.pending.id}/history`,
      `/v1/admin/audit-logs/${s.entry.id}`,
    ]) {
      expect((await new AdminBrowser().fetch('GET', path)).status, path).toBe(401);
      const res = await fetch(`${base}${path}`, {
        headers: { origin: ADMIN_ORIGIN, authorization: `Bearer ${token}` },
      });
      expect(res.status, path).toBe(401);
    }
  });
});

describe('GET /v1/admin/creators/:id/history', () => {
  it('filters, sort and pages change the backend result', async () => {
    const s = await seed();
    const rows = async (query: string) =>
      HistoryResponseSchema.parse((await get(`${BASE_PATH}/${s.pending.id}/history${query}`)).body);
    expect((await rows('')).total).toBe(12);
    expect((await rows('')).items).toHaveLength(10);
    expect((await rows('?page=2')).items).toHaveLength(2);
    expect((await rows('?page=9')).items).toEqual([]);
    expect((await rows('?status=failed')).total).toBe(0);
    expect((await rows('?type=application&page_size=50')).items).toHaveLength(12);
    expect((await rows('?q=ajukan&page_size=50')).total).toBe(12);
    const asc = (await rows('?dir=asc&page_size=50')).items.map((i) => i.id);
    const desc = (await rows('?dir=desc&page_size=50')).items.map((i) => i.id);
    expect(asc).toEqual([...desc].reverse());
  });

  it('refuses every unknown sort, type, status, page size or key with a 400', async () => {
    const s = await seed();
    for (const bad of [
      'sort=password',
      'dir=up',
      'type=chat',
      'status=maybe',
      'page_size=20',
      'page=0',
      'extra=1',
      'type=all&type=account',
    ]) {
      const { res, body } = await get(`${BASE_PATH}/${s.pending.id}/history?${bad}`);
      expect(res.status, bad).toBe(400);
      expect(ErrorResponseSchema.parse(body).code).toBe('VALIDATION_FAILED');
    }
    expect((await get(`${BASE_PATH}/${s.rejected.id}/history`)).res.status).toBe(404);
  });
});

describe('GET /v1/admin/audit-logs/:id', () => {
  it('returns allowlisted lines only; secrets never appear', async () => {
    const s = await seed();
    const { res, body } = await get(`/v1/admin/audit-logs/${s.entry.id}`);
    expect(res.status).toBe(200);
    const parsed = AuditLogDetailSchema.parse(body);
    expect(parsed).toMatchObject({
      action: 'Block creator',
      target: 'Citra (creator)',
      reason: 'Pelanggaran',
      request_id: 'req_1',
    });
    expect(JSON.stringify(body)).not.toMatch(/hunter2|password|token|tok/);
    expect((await get('/v1/admin/audit-logs/nope')).res.status).toBe(404);
    expect(
      (await get('/v1/admin/audit-logs/0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33')).res.status,
    ).toBe(404);
  });
});

describe('private data and writes', () => {
  it('returns no chat data, reasons of other people or admin ids, and never writes', async () => {
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
      (await get(`${BASE_PATH}/${s.pending.id}`)).body,
      (await get(`${BASE_PATH}/${s.creator.id}`)).body,
      (await get(`${BASE_PATH}/${s.pending.id}/history?page_size=50`)).body,
    ]);
    expect(all).not.toMatch(/Alasan rahasia|review_reason|reviewed_by|session_version|message/);
    expect(await counts()).toEqual(before);
  });
});
