import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  CreatorProfileResponseSchema,
  ErrorResponseSchema,
  SubmitAccessRequestResponseSchema,
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

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 7000;
let nextCode = 0;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
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

/** Logs a fresh Telegram account in (always a USER at first) and returns its token and id. */
async function signIn(): Promise<{ token: string; userId: string }> {
  const id = nextTelegramId++;
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

const codeOf = () =>
  `acc${'abcdefgh'[nextCode++ % 8]}${'abcdefgh'[Math.floor(nextCode / 8) % 8]}bbb`.slice(0, 8);
async function creatorNamed(
  name: string,
  opts: { creatorBlocked?: boolean; userBlocked?: boolean } = {},
) {
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(nextTelegramId++),
      displayName: name,
      role: 'CREATOR',
      bio: `bio ${name}`,
      status: opts.userBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  const creator = await prisma.creator.create({
    data: {
      userId: user.id,
      publicCode: codeOf(),
      status: opts.creatorBlocked ? 'BLOCKED' : 'ACTIVE',
    },
  });
  return { user, creator };
}

const post = (code: string, token?: string, payload?: object) =>
  t.app.inject({
    method: 'POST',
    url: `/v1/creators/by-code/${code}/access-requests`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const profile = (code: string, token: string) =>
  t.app.inject({
    method: 'GET',
    url: `/v1/creators/by-code/${code}`,
    headers: { authorization: `Bearer ${token}` },
  });
const DAY = 86_400_000;
const rows = async () => ({
  requests: await prisma.accessRequest.count(),
  outbox: await prisma.outboxEvent.count(),
  audit: await prisma.auditLog.count(),
});

describe('POST /v1/creators/by-code/:code/access-requests', () => {
  it('creates a TRIAL (201), answers a repeat with the same request (200), and the profile turns PENDING', async () => {
    const { token, userId } = await signIn();
    const c = await creatorNamed('Dinda');
    const first = await post(c.creator.publicCode, token);
    expect(first.statusCode).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const body = SubmitAccessRequestResponseSchema.parse(first.json());
    expect(body.request_type).toBe('TRIAL');
    const again = await post(c.creator.publicCode, token);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(body);
    expect(await rows()).toMatchObject({ requests: 1, outbox: 1 });
    const row = await prisma.accessRequest.findFirstOrThrow();
    expect(row).toMatchObject({ customerId: userId, creatorId: c.creator.id, status: 'PENDING' });
    const p = CreatorProfileResponseSchema.parse(
      (await profile(c.creator.publicCode, token)).json(),
    );
    expect(p.access).toMatchObject({ state: 'PENDING', request_type: 'TRIAL' });
    expect(JSON.stringify(first.json())).not.toMatch(/id|creator|status|reason|admin/);
  });

  it('derives the type from the viewer state, ignores a body, and refuses active access (409)', async () => {
    const { token, userId } = await signIn();
    const expired = await creatorNamed('Kirana');
    const revoked = await creatorNamed('Revoked');
    const active = await creatorNamed('Salsa');
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: expired.creator.id,
        startsAt: new Date(Date.now() - 20 * DAY),
        endsAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: revoked.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
        revokedAt: new Date(),
      },
    });
    await prisma.subscription.create({
      data: {
        customerId: userId,
        creatorId: active.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    const other = await signIn();
    const bodyTry = {
      user_id: other.userId,
      type: 'TRIAL',
      creator_id: active.creator.id,
      status: 'APPROVED',
    };
    const r1 = await post(expired.creator.publicCode, token, bodyTry);
    expect(r1.statusCode).toBe(201);
    expect(r1.json().request_type).toBe('RENEWAL');
    expect((await post(revoked.creator.publicCode, token)).json().request_type).toBe('RENEWAL');
    const before = await rows();
    const conflict = await post(active.creator.publicCode, token);
    expect(conflict.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(conflict.json()).code).toBe('ACCESS_ALREADY_ACTIVE');
    expect(await rows()).toEqual(before);
    const stored = await prisma.accessRequest.findMany({
      where: { creatorId: expired.creator.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ customerId: userId, type: 'RENEWAL', status: 'PENDING' });
  });

  it('never touches another customer’s pending request (IDOR)', async () => {
    const a = await signIn();
    const b = await signIn();
    const c = await creatorNamed('Dinda');
    await post(c.creator.publicCode, a.token);
    const res = await post(c.creator.publicCode, b.token);
    expect(res.statusCode).toBe(201);
    expect(await prisma.accessRequest.count({ where: { customerId: a.userId } })).toBe(1);
    expect(await prisma.accessRequest.count({ where: { customerId: b.userId } })).toBe(1);
  });

  it('answers one identical 404 for unknown, malformed and blocked creators, writing nothing', async () => {
    const { token } = await signIn();
    const blocked = await creatorNamed('Citra', { creatorBlocked: true });
    const blockedUser = await creatorNamed('Fajar', { userBlocked: true });
    const messages = new Set<string>();
    for (const code of [
      blocked.creator.publicCode,
      blockedUser.creator.publicCode,
      'abcdefgh',
      'nope',
    ]) {
      const res = await post(code, token);
      expect(res.statusCode, code).toBe(404);
      messages.add(ErrorResponseSchema.parse(res.json()).message);
    }
    expect(messages.size).toBe(1);
    expect(await rows()).toEqual({ requests: 0, outbox: 0, audit: expect.any(Number) });
    expect(await prisma.accessRequest.count()).toBe(0);
  });

  it('refuses a CREATOR (403), no token (401) and a blocked customer (401)', async () => {
    const c = await creatorNamed('Salsa');
    const { token, userId } = await signIn();
    expect((await post(c.creator.publicCode)).statusCode).toBe(401);
    await prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
    expect((await post(c.creator.publicCode, token)).statusCode).toBe(401);
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', role: 'CREATOR' },
    });
    const res = await post(c.creator.publicCode, token);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN_ROLE');
    expect(await prisma.accessRequest.count()).toBe(0);
  });
});

describe('GET by-code last_review', () => {
  it('shows the latest reviewed request with no reason or admin', async () => {
    const { token, userId } = await signIn();
    const c = await creatorNamed('Dinda');
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia', passwordHash: 'x' },
    });
    const none = await profile(c.creator.publicCode, token);
    expect(none.json()).not.toHaveProperty('last_review');
    await prisma.accessRequest.create({
      data: {
        customerId: userId,
        creatorId: c.creator.id,
        type: 'TRIAL',
        status: 'REJECTED',
        reviewedAt: new Date('2026-11-14T02:10:00Z'),
        reviewedByAdminId: admin.id,
        reviewReason: 'Rahasia admin',
      },
    });
    const res = await profile(c.creator.publicCode, token);
    const parsed = CreatorProfileResponseSchema.parse(res.json());
    expect(parsed.last_review).toEqual({
      status: 'REJECTED',
      reviewed_at: '2026-11-14T02:10:00.000Z',
    });
    expect(res.body).not.toMatch(/Rahasia|nadia|reason|admin/);
  });
});
