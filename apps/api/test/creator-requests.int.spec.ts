import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  ApproveCreatorRequestResponseSchema,
  CreatorProfileResponseSchema,
  CreatorRequestReviewResponseSchema,
  ErrorResponseSchema,
  RejectCreatorRequestResponseSchema,
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
const BASE_PATH = '/v1/admin/creator-requests';
const UNKNOWN = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const DAY = 86_400_000;

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 31_000;
let nextCode = 0;

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

/** A real applicant: signs in through Telegram and submits the form with their own token. */
async function applicant(firstName = 'Maya') {
  const id = nextTelegramId++;
  const login = await telegramLogin(id, firstName);
  const submit = await t.app.inject({
    method: 'POST',
    url: '/v1/me/creator-request',
    headers: { authorization: `Bearer ${login.access_token}` },
    payload: {
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya.lestari',
      creator_type: 'AI_CHARACTER',
      description: 'Resep dan tips masak rumahan.',
      rights_confirmed: true,
    },
  });
  expect(submit.statusCode).toBe(200);
  const requestId = (submit.json() as { request: { id: string } }).request.id;
  return { telegramId: id, token: login.access_token, userId: login.user.id, requestId };
}

async function subscribe(customerId: string, startsInDays: number, endsInDays: number) {
  const user = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: user.id, publicCode: `k4m5x2q${String.fromCharCode(97 + nextCode++)}` },
  });
  return prisma.subscription.create({
    data: {
      customerId,
      creatorId: creator.id,
      startsAt: new Date(Date.now() + startsInDays * DAY),
      endsAt: new Date(Date.now() + endsInDays * DAY),
    },
  });
}

const userCounts = async (userId: string) => ({
  user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  applications: await prisma.creatorApplication.findMany({ where: { userId } }),
  creators: await prisma.creator.count({ where: { userId } }),
  outbox: await prisma.outboxEvent.count(),
});

const get = (id: string) => admin.fetch('GET', `${BASE_PATH}/${id}`);
const approve = (id: string, body?: unknown) =>
  admin.fetch('POST', `${BASE_PATH}/${id}/approve`, body);
const reject = (id: string, body: unknown) =>
  admin.fetch('POST', `${BASE_PATH}/${id}/reject`, body);

describe('GET /v1/admin/creator-requests/:id', () => {
  it('shows the request, the applicant and a clear pre-check', async () => {
    const { requestId, userId, telegramId } = await applicant();
    const res = await get(requestId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = CreatorRequestReviewResponseSchema.parse(await res.json());
    expect(body.request).toMatchObject({
      id: requestId,
      status: 'PENDING',
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya.lestari',
      creator_type: 'AI_CHARACTER',
      user: { id: userId, telegram_id: String(telegramId), role: 'USER', status: 'ACTIVE' },
    });
    expect(body.check.block).toBeNull();
    expect(Date.parse(body.check.checked_at)).not.toBeNaN();
  });

  it('shows the blocking subscription from the server (Raka-style)', async () => {
    const { requestId, userId } = await applicant('Raka');
    const sub = await subscribe(userId, -5, 20);
    const body = CreatorRequestReviewResponseSchema.parse(await (await get(requestId)).json());
    expect(body.check.block).toEqual({
      count: 1,
      creator_name: 'Salsa Maheswari',
      ends_at: sub.endsAt.toISOString(),
    });
  });

  it('404 for an unknown and a malformed id', async () => {
    for (const id of [UNKNOWN, 'not-a-uuid', '1%27%3B--']) {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(ErrorResponseSchema.parse(await res.json()).code).toBe('NOT_FOUND');
    }
  });
});

describe('POST approve', () => {
  it('approves with the admin cookie and CSRF, ignoring anything in the body', async () => {
    const { requestId, userId } = await applicant();
    const res = await approve(requestId, {
      status: 'REJECTED',
      user_id: UNKNOWN,
      role: 'USER',
      reviewed_by_admin_id: UNKNOWN,
    });
    expect(res.status).toBe(200);
    const body = ApproveCreatorRequestResponseSchema.parse(await res.json());
    expect(body.request).toMatchObject({
      id: requestId,
      status: 'APPROVED',
      review_reason: null,
      user: { id: userId, role: 'CREATOR', display_name: 'Maya Lestari' },
    });
    expect(body.creator.public_code).toMatch(/^[a-z2-7]{8}$/);

    const after = await userCounts(userId);
    expect(after.user.role).toBe('CREATOR');
    expect(after.creators).toBe(1);
    expect(after.applications[0]).toMatchObject({ status: 'APPROVED', reviewedByAdminId: adminId });
    expect(after.outbox).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'creator.application.approved' },
    });
    expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: adminId, targetId: requestId });
    expect(audit.requestId).toBeTruthy();
  });

  it('converts the same account: the old token dies, a new login is a CREATOR, the link resolves', async () => {
    const { requestId, userId, telegramId, token } = await applicant();
    const customer = await telegramLogin(nextTelegramId++, 'Nadia');
    expect((await approve(requestId)).status).toBe(200);

    // Old session: stale.
    const me = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
    const asUser = await t.app.inject({
      method: 'GET',
      url: '/v1/me/creator-request',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asUser.statusCode).toBe(401);

    // New login: same account, now a CREATOR.
    const relogin = await telegramLogin(telegramId, 'Maya');
    expect(relogin.user).toMatchObject({
      id: userId,
      role: 'CREATOR',
      display_name: 'Maya Lestari',
    });
    const creatorOnly = await t.app.inject({
      method: 'GET',
      url: '/v1/creator/settings',
      headers: { authorization: `Bearer ${relogin.access_token}` },
    });
    expect(creatorOnly.statusCode).toBe(200);

    // The creator's link now resolves for a customer.
    const { public_code } = creatorOnly.json() as { public_code: string };
    const link = await t.app.inject({
      method: 'GET',
      url: `/v1/creators/by-code/${public_code}`,
      headers: { authorization: `Bearer ${customer.access_token}` },
    });
    expect(link.statusCode).toBe(200);
    expect(CreatorProfileResponseSchema.parse(link.json()).display_name).toBe('Maya Lestari');
  });

  it('409 CREATOR_APPROVAL_BLOCKED with the creator and end date, changing nothing', async () => {
    const { requestId, userId } = await applicant('Raka');
    const sub = await subscribe(userId, -5, 20);
    const before = await userCounts(userId);
    const res = await approve(requestId);
    expect(res.status).toBe(409);
    const body = ErrorResponseSchema.parse(await res.json());
    expect(body.code).toBe('CREATOR_APPROVAL_BLOCKED');
    expect(body.details).toEqual({
      count: 1,
      creator_name: 'Salsa Maheswari',
      ends_at: sub.endsAt.toISOString(),
    });
    expect(await userCounts(userId)).toEqual(before);
  });

  it('409 CREATOR_APPROVAL_BLOCKED for a future subscription as well', async () => {
    const { requestId, userId } = await applicant();
    await subscribe(userId, 3, 30);
    const res = await approve(requestId);
    expect(res.status).toBe(409);
    expect(ErrorResponseSchema.parse(await res.json()).code).toBe('CREATOR_APPROVAL_BLOCKED');
  });

  it('409 CREATOR_REQUEST_ALREADY_REVIEWED for a second approve and for a decided request', async () => {
    const { requestId, userId } = await applicant();
    expect((await approve(requestId)).status).toBe(200);
    const again = await approve(requestId);
    expect(again.status).toBe(409);
    const body = ErrorResponseSchema.parse(await again.json());
    expect(body).toMatchObject({
      code: 'CREATOR_REQUEST_ALREADY_REVIEWED',
      details: { status: 'APPROVED' },
    });
    expect(await prisma.creator.count({ where: { userId } })).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('two approves at once: exactly one wins', async () => {
    const { requestId, userId } = await applicant();
    const [a, b] = await Promise.all([approve(requestId), approve(requestId)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.creator.count({ where: { userId } })).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('approve and reject at once: one decision, one outbox event', async () => {
    const { requestId } = await applicant();
    const [a, r] = await Promise.all([approve(requestId), reject(requestId, { reason: 'Tidak.' })]);
    expect([a.status, r.status].sort()).toEqual([200, 409]);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('409 CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE for a blocked applicant, who can still be rejected', async () => {
    const { requestId, userId } = await applicant();
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    const res = await approve(requestId);
    expect(res.status).toBe(409);
    expect(ErrorResponseSchema.parse(await res.json()).code).toBe(
      'CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE',
    );
    expect((await userCounts(userId)).user.role).toBe('USER');
    expect((await reject(requestId, { reason: 'Akun diblokir.' })).status).toBe(200);
  });

  it('404 for an unknown and a malformed id, writing nothing', async () => {
    for (const id of [UNKNOWN, 'not-a-uuid']) {
      expect((await approve(id)).status).toBe(404);
    }
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});

describe('POST reject', () => {
  it('rejects with a reason, keeping the role and the user session', async () => {
    const { requestId, userId, token } = await applicant();
    const res = await reject(requestId, { reason: '  Link Instagram belum bisa diverifikasi.  ' });
    expect(res.status).toBe(200);
    const body = RejectCreatorRequestResponseSchema.parse(await res.json());
    expect(body.request).toMatchObject({
      status: 'REJECTED',
      review_reason: 'Link Instagram belum bisa diverifikasi.',
      user: { role: 'USER' },
    });
    const after = await userCounts(userId);
    expect(after.user.role).toBe('USER');
    expect(after.creators).toBe(0);
    expect(after.outbox).toBe(1);
    const stillWorks = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stillWorks.statusCode).toBe(200);
    // The applicant now sees the stored reason.
    const state = await t.app.inject({
      method: 'GET',
      url: '/v1/me/creator-request',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((state.json() as { request: { review_reason: string } }).request.review_reason).toBe(
      'Link Instagram belum bisa diverifikasi.',
    );
  });

  it('400 with the board message for an empty, blank or missing reason, changing nothing', async () => {
    const { requestId, userId } = await applicant();
    const before = await userCounts(userId);
    for (const body of [{ reason: '' }, { reason: '   \n ' }, {}, { reason: 42 }]) {
      const res = await reject(requestId, body);
      expect(res.status).toBe(400);
      const error = ErrorResponseSchema.parse(await res.json());
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(error.details)).toContain('Alasan wajib diisi.');
    }
    expect(await userCounts(userId)).toEqual(before);
  });

  it('400 for a reason over 300 characters', async () => {
    const { requestId } = await applicant();
    expect((await reject(requestId, { reason: 'a'.repeat(301) })).status).toBe(400);
  });

  it('strips other keys: a status or admin id in the body changes nothing', async () => {
    const { requestId, userId } = await applicant();
    const res = await reject(requestId, {
      reason: 'Belum jelas.',
      status: 'APPROVED',
      role: 'CREATOR',
      reviewed_by_admin_id: UNKNOWN,
    });
    expect(res.status).toBe(200);
    const after = await userCounts(userId);
    expect(after.user.role).toBe('USER');
    expect(after.applications[0]).toMatchObject({ status: 'REJECTED', reviewedByAdminId: adminId });
  });

  it('409 for a request that was already decided, and 404 for unknown ids', async () => {
    const { requestId } = await applicant();
    expect((await reject(requestId, { reason: 'Pertama.' })).status).toBe(200);
    const again = await reject(requestId, { reason: 'Kedua.' });
    expect(again.status).toBe(409);
    expect(ErrorResponseSchema.parse(await again.json())).toMatchObject({
      code: 'CREATOR_REQUEST_ALREADY_REVIEWED',
      details: { status: 'REJECTED' },
    });
    expect((await reject(UNKNOWN, { reason: 'x' })).status).toBe(404);
    expect((await reject('nope', { reason: 'x' })).status).toBe(404);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('lets the user apply again afterwards: a new row, the rejected one untouched', async () => {
    const { requestId, token, userId } = await applicant();
    await reject(requestId, { reason: 'Belum jelas.' });
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/me/creator-request',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        creator_name: 'Maya Lestari',
        instagram_url: 'https://instagram.com/maya.lestari',
        creator_type: 'HUMAN',
        description: 'Lebih jelas.',
        rights_confirmed: true,
      },
    });
    expect(again.statusCode).toBe(200);
    const rows = await prisma.creatorApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual(['REJECTED', 'PENDING']);
  });
});

describe('who can call it', () => {
  it('401 without a session, with a garbage cookie and with a Telegram user token; nothing changes', async () => {
    const { requestId, userId, token } = await applicant();
    const before = await userCounts(userId);
    const anon = new AdminBrowser();
    const garbage = new AdminBrowser();
    garbage.jar.set(ADMIN_COOKIE.access, { value: 'not.a.token', path: '/v1/admin' });

    for (const caller of [anon, garbage]) {
      expect((await caller.fetch('GET', `${BASE_PATH}/${requestId}`)).status).toBe(401);
      expect(
        (await caller.fetch('POST', `${BASE_PATH}/${requestId}/approve`, undefined)).status,
      ).toBeOneOf([401, 403]);
      expect(
        (await caller.fetch('POST', `${BASE_PATH}/${requestId}/reject`, { reason: 'x' })).status,
      ).toBeOneOf([401, 403]);
    }

    // A Telegram user token (Bearer, no admin cookie) never reaches the admin scope.
    for (const [method, path, payload] of [
      ['GET', `${BASE_PATH}/${requestId}`, undefined],
      ['POST', `${BASE_PATH}/${requestId}/approve`, {}],
      ['POST', `${BASE_PATH}/${requestId}/reject`, { reason: 'x' }],
    ] as const) {
      const res = await t.app.inject({
        method,
        url: path,
        headers: { authorization: `Bearer ${token}`, origin: ADMIN_ORIGIN },
        ...(payload ? { payload } : {}),
      });
      expect([401, 403]).toContain(res.statusCode);
    }
    expect(await userCounts(userId)).toEqual(before);
  });

  it('refuses a decision without the CSRF header or from a foreign origin', async () => {
    const { requestId, userId } = await applicant();
    const before = await userCounts(userId);
    const noCsrf = await admin.fetch('POST', `${BASE_PATH}/${requestId}/approve`, undefined, {
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(ErrorResponseSchema.parse(await noCsrf.json()).code).toBe('CSRF_FAILED');
    const foreign = await admin.fetch('POST', `${BASE_PATH}/${requestId}/approve`, undefined, {
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(await userCounts(userId)).toEqual(before);
  });

  it('never returns the reviewing admin id, a hash, a token or a secret', async () => {
    const { requestId } = await applicant();
    const bodies = [await (await get(requestId)).text(), await (await approve(requestId)).text()];
    for (const text of bodies) {
      expect(text).not.toContain(adminId);
      expect(text).not.toMatch(/reviewed_by|password|argon2|token|secret/i);
    }
  });
});
