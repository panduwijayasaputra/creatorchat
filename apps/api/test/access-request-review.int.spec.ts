import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  AccessRequestsResponseSchema,
  ErrorResponseSchema,
  RejectAccessRequestResponseSchema,
  UserListResponseSchema,
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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const reqPath = (id: string, rest = '') => `${BASE_PATH}/${id}/access-requests${rest}`;
const REASON = 'Belum memenuhi syarat.';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
let codeNo = 0;

async function makeCreator(name = 'Dinda Prameswari', status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const owner = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: name, role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: { userId: owner.id, publicCode: `aaaaaaa${String.fromCharCode(97 + codeNo++)}`, status },
  });
}

async function pending(name = 'Raka Putra') {
  const u = await makeUser(name);
  const c = await makeCreator();
  const post = await t.app.inject({
    method: 'POST',
    url: `/v1/creators/by-code/${c.publicCode}/access-requests`,
    headers: bearer(u.token),
  });
  expect(post.statusCode).toBe(201);
  const row = await prisma.accessRequest.findFirstOrThrow({
    where: { customerId: u.userId, creatorId: c.id },
  });
  return { u, c, row };
}

const counts = async () => ({
  requests: await prisma.accessRequest.count(),
  audit: await prisma.auditLog.count(),
  outbox: await prisma.outboxEvent.count(),
  subs: await prisma.subscription.count(),
});
const profileOf = async (token: string, code: string) =>
  (
    await t.app.inject({
      method: 'GET',
      url: `/v1/creators/by-code/${code}`,
      headers: bearer(token),
    })
  ).json();

describe('authentication', () => {
  it('401 without a session and for a Telegram user token; 403 without the CSRF header', async () => {
    const a = await pending();
    const anon = new AdminBrowser();
    const routes: [string, string, unknown?][] = [
      ['GET', reqPath(a.u.userId)],
      ['POST', reqPath(a.u.userId, `/${a.row.id}/reject`), { reason: REASON }],
    ];
    for (const [method, path, body] of routes) {
      const anonStatus = (await anon.fetch(method, path, body, { csrf: false })).status;
      // an unsafe request without the CSRF cookie is refused before auth
      expect(method === 'GET' ? [401] : [401, 403], path).toContain(anonStatus);
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { ...bearer(a.u.token), origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      expect(method === 'GET' ? [401] : [401, 403], path).toContain(res.status);
    }
    const noCsrf = await admin.fetch(
      'POST',
      reqPath(a.u.userId, `/${a.row.id}/reject`),
      { reason: REASON },
      { csrf: false },
    );
    expect(noCsrf.status).toBe(403);
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } })).status).toBe(
      'PENDING',
    );
  });
});

describe('GET /v1/admin/users/:id/access-requests', () => {
  it('lists the user’s pending requests with the exact contract and no-store', async () => {
    const a = await pending();
    const res = await admin.fetch('GET', reqPath(a.u.userId));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = AccessRequestsResponseSchema.parse(await res.json());
    expect(body.items).toEqual([
      {
        id: a.row.id,
        creator: { id: a.c.id, display_name: 'Dinda Prameswari' },
        type: 'TRIAL',
        requested_at: a.row.createdAt.toISOString(),
      },
    ]);
  });

  it('is one identical 404 for unknown, malformed, creator and admin ids', async () => {
    const a = await pending();
    const adminRow = await prisma.adminAccount.findFirstOrThrow();
    const messages = new Set<string>();
    for (const id of [UNKNOWN_ID, 'nope', a.c.userId, adminRow.id]) {
      const res = await admin.fetch('GET', reqPath(id));
      expect(res.status, id).toBe(404);
      messages.add(ErrorResponseSchema.parse(await res.json()).message);
    }
    expect(messages.size).toBe(1);
  });
});

describe('POST …/access-requests/:requestId/reject', () => {
  it('rejects with the reason (200), the customer sees the rejected state and can ask again', async () => {
    const a = await pending();
    const res = await admin.fetch('POST', reqPath(a.u.userId, `/${a.row.id}/reject`), {
      reason: REASON,
    });
    expect(res.status).toBe(200);
    expect(RejectAccessRequestResponseSchema.parse(await res.json())).toEqual({
      request: { id: a.row.id, status: 'REJECTED' },
    });
    const stored = await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } });
    expect(stored).toMatchObject({ status: 'REJECTED', reviewReason: REASON });
    expect(stored.reviewedByAdminId).not.toBeNull();
    const profile = await profileOf(a.u.token, a.c.publicCode);
    expect(profile.access).toEqual({ state: 'GUEST' });
    expect(profile.last_review).toMatchObject({ status: 'REJECTED' });
    expect(JSON.stringify(profile)).not.toContain('syarat');
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { type: 'access_request.rejected' },
    });
    expect(JSON.stringify(event.payload)).not.toContain('syarat');
    const again = await t.app.inject({
      method: 'POST',
      url: `/v1/creators/by-code/${a.c.publicCode}/access-requests`,
      headers: bearer(a.u.token),
    });
    expect(again.statusCode).toBe(201);
  });

  it('empty or missing reason → 400 "Alasan wajib diisi.", nothing changes', async () => {
    const a = await pending();
    const before = await counts();
    for (const body of [{ reason: '' }, { reason: '   ' }, {}]) {
      const res = await admin.fetch('POST', reqPath(a.u.userId, `/${a.row.id}/reject`), body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain('Alasan wajib diisi.');
    }
    expect(await counts()).toEqual(before);
  });

  it('a second reject and a reject after approval are 409 with the current status', async () => {
    const a = await pending();
    await admin.fetch('POST', reqPath(a.u.userId, `/${a.row.id}/reject`), { reason: REASON });
    const before = await counts();
    const second = await admin.fetch('POST', reqPath(a.u.userId, `/${a.row.id}/reject`), {
      reason: 'Lagi.',
    });
    expect(second.status).toBe(409);
    const err = ErrorResponseSchema.parse(await second.json());
    expect(err.code).toBe('ACCESS_REQUEST_ALREADY_REVIEWED');
    expect(err.details).toEqual({ status: 'REJECTED' });
    expect(await counts()).toEqual(before);

    const b = await pending('Maya');
    const grant = await admin.fetch('POST', `${BASE_PATH}/${b.u.userId}/subscriptions`, {
      creator_id: b.c.id,
      duration_days: 30,
      reason: 'Disetujui.',
      access_request_id: b.row.id,
    });
    expect(grant.status).toBe(201);
    const late = await admin.fetch('POST', reqPath(b.u.userId, `/${b.row.id}/reject`), {
      reason: 'Telat.',
    });
    expect(late.status).toBe(409);
    expect(ErrorResponseSchema.parse(await late.json()).details).toEqual({ status: 'APPROVED' });
  });

  it('IDOR: another customer’s request, creator and admin ids, malformed ids are one identical 404', async () => {
    const a = await pending();
    const b = await pending('Maya');
    const adminRow = await prisma.adminAccount.findFirstOrThrow();
    const before = await counts();
    const messages = new Set<string>();
    for (const [userId, requestId] of [
      [b.u.userId, a.row.id],
      [a.c.userId, a.row.id],
      [adminRow.id, a.row.id],
      ['nope', a.row.id],
      [a.u.userId, 'nope'],
      [a.u.userId, UNKNOWN_ID],
    ] as const) {
      const res = await admin.fetch('POST', reqPath(userId, `/${requestId}/reject`), {
        reason: REASON,
      });
      expect(res.status, `${userId}/${requestId}`).toBe(404);
      messages.add(ErrorResponseSchema.parse(await res.json()).message);
    }
    expect(messages.size).toBe(1);
    expect(await counts()).toEqual(before);
  });

  it('ignores an admin id or status in the body', async () => {
    const a = await pending();
    const res = await admin.fetch('POST', reqPath(a.u.userId, `/${a.row.id}/reject`), {
      reason: REASON,
      reviewed_by_admin_id: UNKNOWN_ID,
      status: 'APPROVED',
    });
    expect(res.status).toBe(200);
    const stored = await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } });
    expect(stored.status).toBe('REJECTED');
    expect(stored.reviewedByAdminId).not.toBe(UNKNOWN_ID);
  });
});

describe('POST /v1/admin/users/:id/subscriptions with access_request_id', () => {
  const grantBody = (creatorId: string, requestId?: string) => ({
    creator_id: creatorId,
    duration_days: 30,
    reason: 'Disetujui.',
    ...(requestId ? { access_request_id: requestId } : {}),
  });

  it('approves: access is created, the request is APPROVED and the customer sees it', async () => {
    const a = await pending();
    const res = await admin.fetch(
      'POST',
      `${BASE_PATH}/${a.u.userId}/subscriptions`,
      grantBody(a.c.id, a.row.id),
    );
    expect(res.status).toBe(201);
    const stored = await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } });
    expect(stored).toMatchObject({ status: 'APPROVED' });
    expect(stored.subscriptionEventId).not.toBeNull();
    const profile = await profileOf(a.u.token, a.c.publicCode);
    expect(profile.access.state).toBe('ACTIVE');
    expect(profile.last_review).toMatchObject({ status: 'APPROVED' });
    expect(JSON.stringify(profile)).not.toMatch(/reason|admin/);
    const list = await admin.fetch('GET', reqPath(a.u.userId));
    expect(AccessRequestsResponseSchema.parse(await list.json()).items).toEqual([]);
  });

  it('a reviewed request is 409 ACCESS_REQUEST_ALREADY_REVIEWED; another pair’s request is 404', async () => {
    const a = await pending();
    const other = await makeCreator('Kirana');
    const before = await counts();
    const wrong = await admin.fetch(
      'POST',
      `${BASE_PATH}/${a.u.userId}/subscriptions`,
      grantBody(other.id, a.row.id),
    );
    expect(wrong.status).toBe(404);
    await admin.fetch('POST', reqPath(a.u.userId, `/${a.row.id}/reject`), { reason: REASON });
    const mid = await counts();
    const late = await admin.fetch(
      'POST',
      `${BASE_PATH}/${a.u.userId}/subscriptions`,
      grantBody(a.c.id, a.row.id),
    );
    expect(late.status).toBe(409);
    const err = ErrorResponseSchema.parse(await late.json());
    expect(err.code).toBe('ACCESS_REQUEST_ALREADY_REVIEWED');
    expect(err.details).toEqual({ status: 'REJECTED' });
    expect(await counts()).toEqual(mid);
    expect(before.subs).toBe(mid.subs);
  });

  it('a direct grant closes the pending request', async () => {
    const a = await pending();
    const res = await admin.fetch(
      'POST',
      `${BASE_PATH}/${a.u.userId}/subscriptions`,
      grantBody(a.c.id),
    );
    expect(res.status).toBe(201);
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } })).status).toBe(
      'APPROVED',
    );
  });
});

describe('GET /v1/admin/users?access=pending', () => {
  it('lists only users with a pending access request and a count; bad values are 400', async () => {
    const a = await pending();
    await makeUser('Tanpa Permintaan');
    const res = await admin.fetch('GET', `${BASE_PATH}?access=pending`);
    expect(res.status).toBe(200);
    const body = UserListResponseSchema.parse(await res.json());
    expect(body.items.map((i) => i.id)).toEqual([a.u.userId]);
    expect(body.items[0]?.pending_access_count).toBe(1);
    for (const bad of ['access=all', 'access=', 'access=pending&access=any']) {
      expect((await admin.fetch('GET', `${BASE_PATH}?${bad}`)).status, bad).toBe(400);
    }
  });
});

describe('History', () => {
  it('shows the three access request labels on the user History without a reason', async () => {
    const a = await pending();
    const b = await makeCreator('Kirana');
    await t.app.inject({
      method: 'POST',
      url: `/v1/creators/by-code/${b.publicCode}/access-requests`,
      headers: bearer(a.u.token),
    });
    const second = await prisma.accessRequest.findFirstOrThrow({ where: { creatorId: b.id } });
    await admin.fetch('POST', `${BASE_PATH}/${a.u.userId}/subscriptions`, {
      creator_id: a.c.id,
      duration_days: 30,
      reason: 'Disetujui.',
      access_request_id: a.row.id,
    });
    await admin.fetch('POST', reqPath(a.u.userId, `/${second.id}/reject`), {
      reason: 'Rahasia admin',
    });
    const res = await admin.fetch('GET', `${BASE_PATH}/${a.u.userId}/history?page_size=50`);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const label of ['Minta akses', 'Setujui akses', 'Tolak akses'])
      expect(text).toContain(label);
    expect(text).not.toContain('Rahasia');
  });
});
