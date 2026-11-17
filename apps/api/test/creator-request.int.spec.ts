import {
  AccountSecurityService,
  buildSignedInitData,
  loadEnv,
  signAccessToken,
} from '@creatorchat/backend-core';
import {
  CreatorRequestStateResponseSchema,
  ErrorResponseSchema,
  SubmitCreatorRequestResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const USER_SECRET = 'user-session-secret-'.padEnd(48, 'u');
const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');
const URL = '/v1/me/creator-request';

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let security: AccountSecurityService;
let nextTelegramId = 11_000;
let nextCode = 0;

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
  );
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

async function login(id: number, firstName: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
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

async function customerSignIn(name = 'Maya') {
  const body = await login(nextTelegramId++, name);
  return { token: body.access_token, userId: body.user.id };
}

async function creatorSignIn() {
  const id = nextTelegramId++;
  const first = await login(id, 'Salsa');
  await security.changeRole(first.user.id, 'CREATOR');
  await prisma.creator.create({
    data: { userId: first.user.id, publicCode: `k4m5x2q${String.fromCharCode(97 + nextCode++)}` },
  });
  const second = await login(id, 'Salsa');
  return { token: second.access_token, userId: first.user.id };
}

/** A creator row (no sign-in needed) that a customer can hold a subscription with. */
async function bareCreator(name: string) {
  const user = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: name, role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: { userId: user.id, publicCode: `k4m5x2q${String.fromCharCode(97 + nextCode++)}` },
  });
}

const DAY = 86_400_000;
const subscribe = async (
  customerId: string,
  name: string,
  startsInDays: number,
  endsInDays: number,
) => {
  const creator = await bareCreator(name);
  return prisma.subscription.create({
    data: {
      customerId,
      creatorId: creator.id,
      startsAt: new Date(Date.now() + startsInDays * DAY),
      endsAt: new Date(Date.now() + endsInDays * DAY),
    },
  });
};

const valid = {
  creator_name: 'Maya Lestari',
  instagram_url: 'https://www.instagram.com/maya.lestari/?igsh=1',
  creator_type: 'HUMAN',
  description: 'Resep dan tips masak rumahan untuk pemula.',
  rights_confirmed: true,
};
const submit = (payload: unknown, token?: string) =>
  t.app.inject({
    method: 'POST',
    url: URL,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const read = (token?: string) =>
  t.app.inject({
    method: 'GET',
    url: URL,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const rows = (userId: string) => prisma.creatorApplication.count({ where: { userId } });

describe('POST /v1/me/creator-request', () => {
  it('stores a PENDING request, normalises the link and leaves the role as USER', async () => {
    const { token, userId } = await customerSignIn();
    const res = await submit(valid, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { request } = SubmitCreatorRequestResponseSchema.parse(res.json());
    expect(request).toMatchObject({
      status: 'PENDING',
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya.lestari',
      creator_type: 'HUMAN',
      review_reason: null,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ role: 'USER', status: 'ACTIVE' });
    expect(await rows(userId)).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'creator.application.submitted' } }),
    ).toBe(1);
  });

  it('ignores user_id, role, status and id in the body', async () => {
    const mine = await customerSignIn();
    const other = await customerSignIn('Raka');
    const res = await submit(
      { ...valid, user_id: other.userId, role: 'CREATOR', status: 'APPROVED', id: 'x' },
      mine.token,
    );
    expect(res.statusCode).toBe(200);
    expect(await rows(mine.userId)).toBe(1);
    expect(await rows(other.userId)).toBe(0);
    const stored = await prisma.creatorApplication.findFirstOrThrow({
      where: { userId: mine.userId },
    });
    expect(stored.status).toBe('PENDING');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: mine.userId } })).role).toBe('USER');
  });

  it.each([
    ['a look-alike host', { instagram_url: 'https://instagram.com.evil.com/maya' }],
    ['a non-profile path', { instagram_url: 'https://instagram.com/maya/posts' }],
    ['no link', { instagram_url: '' }],
    ['an empty name', { creator_name: '  ' }],
    ['a 41-character name', { creator_name: 'a'.repeat(41) }],
    ['an empty description', { description: '   ' }],
    ['a 301-character description', { description: 'a'.repeat(301) }],
    ['an unknown type', { creator_type: 'BOTH' }],
    ['the statement unchecked', { rights_confirmed: false }],
    ['the statement missing', { rights_confirmed: undefined }],
  ])('400 VALIDATION_FAILED for %s, writing nothing', async (_label, patch) => {
    const { token, userId } = await customerSignIn();
    const res = await submit({ ...valid, ...patch }, token);
    expect(res.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    expect(await rows(userId)).toBe(0);
  });

  it('400 for an empty body', async () => {
    const { token } = await customerSignIn();
    expect((await submit(undefined, token)).statusCode).toBe(400);
  });

  it('is idempotent: a repeat, and five at once, give one row and one id', async () => {
    const { token, userId } = await customerSignIn();
    const first = SubmitCreatorRequestResponseSchema.parse((await submit(valid, token)).json());
    const again = SubmitCreatorRequestResponseSchema.parse((await submit(valid, token)).json());
    expect(again.request.id).toBe(first.request.id);

    const other = await customerSignIn('Luna');
    const results = await Promise.all(Array.from({ length: 5 }, () => submit(valid, other.token)));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const ids = new Set(
      results.map((r) => SubmitCreatorRequestResponseSchema.parse(r.json()).request.id),
    );
    expect(ids.size).toBe(1);
    expect(await rows(userId)).toBe(1);
    expect(await rows(other.userId)).toBe(1);
  });

  it('409 CREATOR_REQUEST_BLOCKED while a subscription is active, changing nothing', async () => {
    const { token, userId } = await customerSignIn('Raka');
    const sub = await subscribe(userId, 'Salsa Maheswari', -5, 10);
    const res = await submit(valid, token);
    expect(res.statusCode).toBe(409);
    const body = ErrorResponseSchema.parse(res.json());
    expect(body.code).toBe('CREATOR_REQUEST_BLOCKED');
    expect(body.details).toEqual({
      creator_name: 'Salsa Maheswari',
      ends_at: sub.endsAt.toISOString(),
    });
    expect(await rows(userId)).toBe(0);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after).toMatchObject({ revokedAt: null, updatedAt: sub.updatedAt });
  });

  it('also blocks a future subscription, but not an ended or a revoked one', async () => {
    const future = await customerSignIn('F');
    await subscribe(future.userId, 'Future', 3, 30);
    expect((await submit(valid, future.token)).statusCode).toBe(409);

    const done = await customerSignIn('E');
    await subscribe(done.userId, 'Ended', -30, -1);
    const revoked = await subscribe(done.userId, 'Revoked', -5, 20);
    await prisma.subscription.update({
      where: { id: revoked.id },
      data: { revokedAt: new Date() },
    });
    expect((await submit(valid, done.token)).statusCode).toBe(200);
  });

  it('creates a new request after a rejection and leaves the rejected one alone', async () => {
    const { token, userId } = await customerSignIn();
    const old = await prisma.creatorApplication.create({
      data: {
        userId,
        creatorName: 'Maya',
        instagramUrl: 'https://instagram.com/old',
        creatorType: 'HUMAN',
        description: 'lama',
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewReason: 'Link belum bisa diverifikasi',
      },
    });
    const res = await submit(valid, token);
    expect(res.statusCode).toBe(200);
    expect(await rows(userId)).toBe(2);
    expect(SubmitCreatorRequestResponseSchema.parse(res.json()).request.id).not.toBe(old.id);
    const state = CreatorRequestStateResponseSchema.parse((await read(token)).json());
    expect(state.request?.status).toBe('PENDING');
    expect(
      (await prisma.creatorApplication.findUniqueOrThrow({ where: { id: old.id } })).status,
    ).toBe('REJECTED');
  });

  it('403 FORBIDDEN_ROLE for a creator, writing nothing', async () => {
    const { token, userId } = await creatorSignIn();
    const res = await submit(valid, token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    expect(await rows(userId)).toBe(0);
  });

  it('401 for no token, garbage and an admin token', async () => {
    for (const bad of [undefined, 'garbage']) {
      expect((await submit(valid, bad)).statusCode).toBe(401);
    }
    const admin = await prisma.adminAccount.create({
      data: { username: 'root', passwordHash: 'x' },
    });
    const session = await prisma.session.create({
      data: { adminId: admin.id, refreshTokenHash: 'h', expiresAt: new Date(Date.now() + 60_000) },
    });
    const adminToken = await signAccessToken(
      ACCESS,
      { adminId: admin.id, sessionId: session.id },
      new Date(),
      900,
    );
    expect((await submit(valid, adminToken)).statusCode).toBe(401);
    expect(await prisma.creatorApplication.count()).toBe(0);
  });

  it('401 for a blocked account and for a session made stale by a role change, writing nothing', async () => {
    const blocked = await customerSignIn();
    await security.blockUser(blocked.userId);
    expect((await submit(valid, blocked.token)).statusCode).toBe(401);

    const promoted = await customerSignIn('P');
    await security.changeRole(promoted.userId, 'CREATOR');
    expect((await submit(valid, promoted.token)).statusCode).toBe(401);
    expect(await prisma.creatorApplication.count()).toBe(0);
  });
});

describe('GET /v1/me/creator-request', () => {
  it('is empty for a fresh user and no-store', async () => {
    const { token } = await customerSignIn();
    const res = await read(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(CreatorRequestStateResponseSchema.parse(res.json())).toEqual({
      request: null,
      blocked: null,
    });
  });

  it('shows the latest request and the blocking subscription', async () => {
    const { token, userId } = await customerSignIn();
    await submit(valid, token);
    const sub = await subscribe(userId, 'Salsa Maheswari', -5, 10);
    const state = CreatorRequestStateResponseSchema.parse((await read(token)).json());
    expect(state.request?.status).toBe('PENDING');
    expect(state.blocked).toEqual({
      creator_name: 'Salsa Maheswari',
      ends_at: sub.endsAt.toISOString(),
    });
  });

  it('never shows another user a request or a subscription', async () => {
    const a = await customerSignIn('A');
    const b = await customerSignIn('B');
    await submit(valid, a.token);
    await subscribe(a.userId, 'Salsa', -5, 10);
    expect(CreatorRequestStateResponseSchema.parse((await read(b.token)).json())).toEqual({
      request: null,
      blocked: null,
    });
  });

  it('403 for a creator, 401 without a token or with a blocked account', async () => {
    const creator = await creatorSignIn();
    expect((await read(creator.token)).statusCode).toBe(403);
    expect((await read()).statusCode).toBe(401);
    const blocked = await customerSignIn();
    await security.blockUser(blocked.userId);
    expect((await read(blocked.token)).statusCode).toBe(401);
  });

  const application = (userId: string, over: Record<string, unknown> = {}) =>
    prisma.creatorApplication.create({
      data: {
        userId,
        creatorName: 'Luna Aurora',
        instagramUrl: 'https://instagram.com/luna.aurora',
        creatorType: 'AI_CHARACTER',
        description: 'Karakter AI penjelajah malam.',
        ...over,
      } as never,
    });

  it('returns a rejected request with its reason and review time', async () => {
    const { token, userId } = await customerSignIn();
    const reviewedAt = new Date('2026-11-15T00:00:00.000Z');
    await application(userId, {
      status: 'REJECTED',
      reviewedAt,
      reviewReason: 'Link Instagram belum bisa kami verifikasi.',
    });
    const state = CreatorRequestStateResponseSchema.parse((await read(token)).json());
    expect(state.request).toMatchObject({
      status: 'REJECTED',
      creator_name: 'Luna Aurora',
      creator_type: 'AI_CHARACTER',
      review_reason: 'Link Instagram belum bisa kami verifikasi.',
      reviewed_at: reviewedAt.toISOString(),
    });
  });

  it('returns a pending request with the submitted, normalised values and no review data', async () => {
    const { token } = await customerSignIn();
    await submit(valid, token);
    const state = CreatorRequestStateResponseSchema.parse((await read(token)).json());
    expect(state.request).toMatchObject({
      status: 'PENDING',
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya.lestari',
      creator_type: 'HUMAN',
      reviewed_at: null,
      review_reason: null,
    });
  });

  it('returns only the newest request; the older rejected one never appears', async () => {
    const { token, userId } = await customerSignIn();
    await application(userId, {
      status: 'REJECTED',
      reviewedAt: new Date(),
      reviewReason: 'ALASAN-LAMA-RAHASIA',
      creatorName: 'Nama Lama',
      createdAt: new Date(Date.now() - DAY),
    });
    await submit(valid, token);
    const res = await read(token);
    const state = CreatorRequestStateResponseSchema.parse(res.json());
    expect(state.request?.status).toBe('PENDING');
    expect(state.request?.creator_name).toBe('Maya Lestari');
    expect(res.body).not.toContain('ALASAN-LAMA-RAHASIA');
    expect(res.body).not.toContain('Nama Lama');
  });

  it('exposes no user id and no reviewing admin id', async () => {
    const { token, userId } = await customerSignIn();
    await application(userId, {
      status: 'REJECTED',
      reviewedAt: new Date(),
      reviewReason: 'x',
    });
    const res = await read(token);
    const request = (res.json() as { request: Record<string, unknown> }).request;
    expect(Object.keys(request).sort()).toEqual([
      'created_at',
      'creator_name',
      'creator_type',
      'description',
      'id',
      'instagram_url',
      'review_reason',
      'reviewed_at',
      'status',
    ]);
    expect(res.body).not.toContain(userId);
  });

  it('answers 401 to a submit once the account was approved meanwhile, writing nothing', async () => {
    const { token, userId } = await customerSignIn();
    await application(userId, {
      status: 'REJECTED',
      reviewedAt: new Date(),
      reviewReason: 'x',
    });
    await security.changeRole(userId, 'CREATOR');
    expect((await submit(valid, token)).statusCode).toBe(401);
    expect(await rows(userId)).toBe(1);
  });
});
