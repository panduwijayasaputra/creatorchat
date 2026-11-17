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

const REASON = 'Kompensasi gangguan layanan pekan lalu.';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const UNKNOWN_ID = UNKNOWN;
const listPath = (id: string, qs = '') => `${BASE_PATH}/${id}/subscriptions${qs}`;
const subPath = (id: string, subId: string, action: string) =>
  `${BASE_PATH}/${id}/subscriptions/${subId}/${action}`;
let codeNo = 0;

async function makeCreator(name = 'Salsa Maheswari', status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const owner = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: name, role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: { userId: owner.id, publicCode: `aaaaaaa${String.fromCharCode(97 + codeNo++)}`, status },
  });
}

const grantBody = (creatorId: string, extra: object = {}) => ({
  creator_id: creatorId,
  duration_days: 30,
  reason: REASON,
  ...extra,
});

async function grantedPair() {
  const u = await makeUser();
  const c = await makeCreator();
  const res = await admin.fetch('POST', listPath(u.userId), grantBody(c.id));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { subscription: { id: string } };
  return { u, c, subId: body.subscription.id };
}

const rowCounts = async () => ({
  subs: await prisma.subscription.count(),
  events: await prisma.subscriptionEvent.count(),
  audit: await prisma.auditLog.count({ where: { action: { startsWith: 'subscription.' } } }),
  outbox: await prisma.outboxEvent.count(),
});

describe('authentication', () => {
  it('401 without a session, and for a Telegram user token, on every route', async () => {
    const u = await makeUser();
    const anon = new AdminBrowser();
    const routes: [string, string, unknown?][] = [
      ['GET', listPath(u.userId)],
      ['GET', `${BASE_PATH}/${u.userId}/grantable-creators`],
      ['POST', listPath(u.userId), grantBody(UNKNOWN_ID)],
      ['POST', subPath(u.userId, UNKNOWN_ID, 'extend'), { duration_days: 7, reason: 'a' }],
      ['POST', subPath(u.userId, UNKNOWN_ID, 'revoke'), { reason: 'a' }],
    ];
    for (const [method, path, body] of routes) {
      const anonStatus = (await anon.fetch(method, path, body, { csrf: false })).status;
      // an unsafe request without the CSRF cookie is refused before auth (as in US-019)
      if (method === 'GET') expect(anonStatus).toBe(401);
      else expect([401, 403]).toContain(anonStatus);
      const res = await t.app.inject({
        method: method as 'GET' | 'POST',
        url: path,
        headers: { ...bearer(u.token), origin: ADMIN_ORIGIN },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      expect(method === 'GET' ? [401] : [401, 403]).toContain(res.statusCode);
    }
  });

  it('refuses a write without the CSRF token', async () => {
    const u = await makeUser();
    const c = await makeCreator();
    const res = await admin.fetch('POST', listPath(u.userId), grantBody(c.id), { csrf: false });
    expect(res.status).toBe(403);
    expect(await rowCounts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0 });
  });
});

describe('grant, list, extend, revoke', () => {
  it('walks the whole flow with the reason in the event and audit rows', async () => {
    const u = await makeUser();
    const c = await makeCreator();

    const granted = await admin.fetch('POST', listPath(u.userId), grantBody(c.id));
    expect(granted.status).toBe(201);
    expect(granted.headers.get('cache-control')).toBe('no-store');
    const { subscription } = (await granted.json()) as {
      subscription: { id: string; status: string; ends_at: string; creator_id: string };
    };
    expect(subscription).toMatchObject({ status: 'ACTIVE', creator_id: c.id });

    const list = await admin.fetch('GET', listPath(u.userId));
    const listed = (await list.json()) as {
      total: number;
      items: { id: string; status: string }[];
    };
    expect(listed.total).toBe(1);
    expect(listed.items[0]).toMatchObject({ id: subscription.id, status: 'ACTIVE' });

    const extended = await admin.fetch('POST', subPath(u.userId, subscription.id, 'extend'), {
      duration_days: 30,
      reason: 'Permintaan user.',
    });
    expect(extended.status).toBe(200);
    const ext = (await extended.json()) as { subscription: { ends_at: string } };
    expect(new Date(ext.subscription.ends_at) > new Date(subscription.ends_at)).toBe(true);

    const revoked = await admin.fetch('POST', subPath(u.userId, subscription.id, 'revoke'), {
      reason: 'Pelanggaran ketentuan layanan.',
    });
    expect(revoked.status).toBe(200);
    expect(
      ((await revoked.json()) as { subscription: { status: string } }).subscription.status,
    ).toBe('REVOKED');
    expect(
      (
        (await (await admin.fetch('GET', listPath(u.userId))).json()) as {
          items: { status: string }[];
        }
      ).items[0]?.status,
    ).toBe('REVOKED');

    const events = await prisma.subscriptionEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.type, e.reason, e.adminId])).toEqual([
      ['GRANT', REASON, adminId],
      ['EXTEND', 'Permintaan user.', adminId],
      ['REVOKE', 'Pelanggaran ketentuan layanan.', adminId],
    ]);
    const audits = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'subscription.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => [a.action, a.reason])).toEqual([
      ['subscription.granted', REASON],
      ['subscription.extended', 'Permintaan user.'],
      ['subscription.revoked', 'Pelanggaran ketentuan layanan.'],
    ]);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('409 when the pair is already active, then re-grant works after a revoke and old events stay', async () => {
    const { u, c, subId } = await grantedPair();
    const again = await admin.fetch('POST', listPath(u.userId), grantBody(c.id));
    expect(again.status).toBe(409);
    expect(ErrorResponseSchema.parse(await again.json()).code).toBe('SUBSCRIPTION_ACTIVE');
    expect(await prisma.subscriptionEvent.count()).toBe(1);

    await admin.fetch('POST', subPath(u.userId, subId, 'revoke'), { reason: 'x' });
    const regrant = await admin.fetch('POST', listPath(u.userId), grantBody(c.id));
    expect(regrant.status).toBe(201);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.subscriptionEvent.count()).toBe(3);
  });

  it('409 for a revoked extend and a repeated revoke, writing nothing more', async () => {
    const { u, subId } = await grantedPair();
    await admin.fetch('POST', subPath(u.userId, subId, 'revoke'), { reason: 'x' });
    const before = await rowCounts();
    const ext = await admin.fetch('POST', subPath(u.userId, subId, 'extend'), {
      duration_days: 7,
      reason: 'x',
    });
    expect(ext.status).toBe(409);
    expect(ErrorResponseSchema.parse(await ext.json()).code).toBe('SUBSCRIPTION_REVOKED');
    const rev = await admin.fetch('POST', subPath(u.userId, subId, 'revoke'), { reason: 'x' });
    expect(rev.status).toBe(409);
    expect(ErrorResponseSchema.parse(await rev.json()).code).toBe('SUBSCRIPTION_NOT_ACTIVE');
    expect(await rowCounts()).toEqual(before);
  });

  it('409 for a CREATOR account, a BLOCKED user and a BLOCKED creator', async () => {
    const c = await makeCreator();
    const creatorUser = await prisma.user.findFirstOrThrow({ where: { id: c.userId } });
    const asCreator = await admin.fetch('POST', listPath(creatorUser.id), grantBody(c.id));
    expect(asCreator.status).toBe(409);
    expect(ErrorResponseSchema.parse(await asCreator.json()).code).toBe('USER_ROLE_CONFLICT');

    const blocked = await makeUser();
    await prisma.user.update({ where: { id: blocked.userId }, data: { status: 'BLOCKED' } });
    const r2 = await admin.fetch('POST', listPath(blocked.userId), grantBody(c.id));
    expect(ErrorResponseSchema.parse(await r2.json()).code).toBe('USER_STATUS_CONFLICT');

    const u = await makeUser();
    const bc = await makeCreator('Blocked', 'BLOCKED');
    const r3 = await admin.fetch('POST', listPath(u.userId), grantBody(bc.id));
    expect(r3.status).toBe(409);
    expect(ErrorResponseSchema.parse(await r3.json()).code).toBe('CREATOR_NOT_ACTIVE');
    expect(await rowCounts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0 });
  });

  it('writes one event for two parallel grants', async () => {
    const u = await makeUser();
    const c = await makeCreator();
    const res = await Promise.all([
      admin.fetch('POST', listPath(u.userId), grantBody(c.id)),
      admin.fetch('POST', listPath(u.userId), grantBody(c.id)),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rowCounts()).toEqual({ subs: 1, events: 1, audit: 1, outbox: 1 });
  });
});

describe('validation', () => {
  it('400 for an empty reason on all three writes, changing nothing', async () => {
    const { u, c, subId } = await grantedPair();
    const before = await rowCounts();
    for (const reason of ['', '   ']) {
      const g = await admin.fetch('POST', listPath(u.userId), grantBody(c.id, { reason }));
      expect(g.status).toBe(400);
      expect(JSON.stringify(await g.json())).toContain('Alasan wajib diisi.');
      expect(
        (
          await admin.fetch('POST', subPath(u.userId, subId, 'extend'), {
            duration_days: 7,
            reason,
          })
        ).status,
      ).toBe(400);
      expect(
        (await admin.fetch('POST', subPath(u.userId, subId, 'revoke'), { reason })).status,
      ).toBe(400);
    }
    expect(await rowCounts()).toEqual(before);
  });

  it('400 for a bad duration, both or neither of duration / date, and an out-of-range date', async () => {
    const u = await makeUser();
    const c = await makeCreator();
    for (const extra of [
      { duration_days: 31 },
      { end_date: '2030-01-01', duration_days: undefined },
      { end_date: '2026-02-30', duration_days: undefined },
      { end_date: '2001-01-01', duration_days: undefined },
      { duration_days: undefined },
      { duration_days: 30, end_date: '2027-01-01' },
    ]) {
      const res = await admin.fetch('POST', listPath(u.userId), grantBody(c.id, extra));
      expect(res.status).toBe(400);
    }
    expect(await rowCounts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0 });
  });

  it('400 for every unknown list key, sort, status, ends, page size and page', async () => {
    const u = await makeUser();
    for (const qs of [
      'x=1',
      'sort=password',
      'status=gone',
      'ends=soon',
      'dir=up',
      'page_size=11',
      'page=0',
    ]) {
      expect((await admin.fetch('GET', listPath(u.userId, `?${qs}`))).status).toBe(400);
    }
    const ok = await admin.fetch('GET', listPath(u.userId, '?sort=creator&dir=asc&page_size=25'));
    expect(ok.status).toBe(200);
  });
});

describe('ids (IDOR)', () => {
  it("404 for another user's subscription, identical to an unknown id", async () => {
    const { subId } = await grantedPair();
    const other = await makeUser('Other');
    const before = await rowCounts();
    const bodies = new Set<string>();
    for (const [id, sub] of [
      [other.userId, subId],
      [other.userId, UNKNOWN_ID],
      [other.userId, 'nope'],
    ] as const) {
      const ext = await admin.fetch('POST', subPath(id, sub, 'extend'), {
        duration_days: 7,
        reason: 'x',
      });
      const rev = await admin.fetch('POST', subPath(id, sub, 'revoke'), { reason: 'x' });
      expect([ext.status, rev.status]).toEqual([404, 404]);
      bodies.add(JSON.stringify({ ...((await ext.json()) as object), request_id: '' }));
    }
    expect(bodies.size).toBe(1);
    expect(await rowCounts()).toEqual(before);
  });

  it('404 for unknown, malformed, creator and admin ids on the list and picker', async () => {
    const c = await makeCreator();
    for (const id of [UNKNOWN_ID, 'nope', c.id, c.userId, adminId]) {
      expect((await admin.fetch('GET', listPath(id))).status).toBe(404);
      expect((await admin.fetch('GET', `${BASE_PATH}/${id}/grantable-creators`)).status).toBe(404);
      // a creator's user row exists but is not a customer: a role conflict, never a grant
      const grant = await admin.fetch('POST', listPath(id), grantBody(c.id));
      expect(grant.status).toBe(id === c.userId ? 409 : 404);
    }
  });

  it('a grant for an unknown creator id is 404 and writes nothing', async () => {
    const u = await makeUser();
    expect((await admin.fetch('POST', listPath(u.userId), grantBody(UNKNOWN_ID))).status).toBe(404);
    expect(await rowCounts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0 });
  });
});

describe('privacy', () => {
  it('lists the picker without active pairs, and no body leaks admin ids, reasons or sessions', async () => {
    const { u } = await grantedPair();
    const fresh = await makeCreator('Kirana Larasati');
    const picker = await admin.fetch('GET', `${BASE_PATH}/${u.userId}/grantable-creators`);
    const pickerBody = (await picker.json()) as { items: { id: string; display_name: string }[] };
    expect(pickerBody.items.map((i) => i.id)).toEqual([fresh.id]);

    const list = JSON.stringify(await (await admin.fetch('GET', listPath(u.userId))).json());
    const action = JSON.stringify(
      await (await admin.fetch('POST', listPath(u.userId), grantBody(fresh.id))).json(),
    );
    for (const text of [list, action, JSON.stringify(pickerBody)]) {
      expect(text).not.toContain(adminId);
      expect(text).not.toContain(REASON);
      expect(text).not.toMatch(/session|admin_id|changes|token/i);
    }
  });

  it('writes nothing on reads', async () => {
    const { u } = await grantedPair();
    const before = await rowCounts();
    await admin.fetch('GET', listPath(u.userId));
    await admin.fetch('GET', `${BASE_PATH}/${u.userId}/grantable-creators`);
    expect(await rowCounts()).toEqual(before);
  });
});
