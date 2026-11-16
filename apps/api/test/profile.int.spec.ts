import {
  AccountSecurityService,
  buildSignedInitData,
  loadEnv,
  signAccessToken,
} from '@creatorchat/backend-core';
import {
  ErrorResponseSchema,
  MeResponseSchema,
  TelegramLoginResponseSchema,
  UpdateProfileResponseSchema,
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
let security: AccountSecurityService;
let nextTelegramId = 9500;

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

async function signIn(photo = 'https://t.me/i/userpic/320/maya.jpg') {
  const id = nextTelegramId++;
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: 'Maya', username: `maya${id}`, photo_url: photo },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id, telegramId: id };
}

const patch = (payload: unknown, token?: string) =>
  t.app.inject({
    method: 'PATCH',
    url: '/v1/me/profile',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: payload as object,
  });

describe('PATCH /v1/me/profile', () => {
  it('saves trimmed name and bio, returns the profile and shows it on /v1/me', async () => {
    const { token, userId } = await signIn();
    const res = await patch({ display_name: '  Maya L ', bio: ' Pecinta masak ' }, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = UpdateProfileResponseSchema.parse(res.json());
    expect(body).toMatchObject({ id: userId, display_name: 'Maya L', bio: 'Pecinta masak' });
    const me = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(MeResponseSchema.parse(me.json())).toMatchObject({
      display_name: 'Maya L',
      bio: 'Pecinta masak',
    });
  });

  it('accepts the limits (name 40, bio 160) and rejects one more with VALIDATION_FAILED', async () => {
    const { token } = await signIn();
    expect(
      (await patch({ display_name: 'a'.repeat(40), bio: 'b'.repeat(160) }, token)).statusCode,
    ).toBe(200);
    for (const bad of [
      { display_name: 'a'.repeat(41) },
      { display_name: 'a', bio: 'b'.repeat(161) },
      { display_name: '   ' },
      { display_name: '' },
      {},
      { display_name: 123 },
    ]) {
      const res = await patch(bad, token);
      expect(res.statusCode).toBe(400);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    }
  });

  it('ignores id, role, telegram_id, username, status and session_version in the body', async () => {
    const { token, userId, telegramId } = await signIn();
    const other = await signIn();
    const res = await patch(
      {
        display_name: 'Maya L',
        id: other.userId,
        user_id: other.userId,
        role: 'CREATOR',
        telegram_id: '1',
        username: 'hacker',
        telegram_username: 'hacker',
        status: 'BLOCKED',
        session_version: 99,
        avatar_url: 'https://evil.example/x.png',
        telegram_avatar_url: 'https://evil.example/y.png',
      },
      token,
    );
    expect(res.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row).toMatchObject({
      displayName: 'Maya L',
      role: 'USER',
      status: 'ACTIVE',
      telegramId: BigInt(telegramId),
      telegramUsername: `maya${telegramId}`,
      sessionVersion: 1,
      avatarUrl: 'https://t.me/i/userpic/320/maya.jpg',
      telegramAvatarUrl: 'https://t.me/i/userpic/320/maya.jpg',
    });
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(untouched.displayName).toBe('Maya');
  });

  it('is scoped to the caller: two users never change each other', async () => {
    const a = await signIn();
    const b = await signIn();
    await patch({ display_name: 'Only A', bio: 'a' }, a.token);
    await patch({ display_name: 'Only B' }, b.token);
    const rows = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.displayName, r.bio])).toEqual([
      ['Only A', 'a'],
      ['Only B', null],
    ]);
  });

  it('stores HTML-looking text as plain text', async () => {
    const { token, userId } = await signIn();
    const text = '<img src=x onerror=alert(1)>';
    expect((await patch({ display_name: 'Maya', bio: text }, token)).statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).bio).toBe(text);
  });

  it('saving the same values twice is harmless', async () => {
    const { token } = await signIn();
    const first = await patch({ display_name: 'Maya L', bio: 'halo' }, token);
    const second = await patch({ display_name: 'Maya L', bio: 'halo' }, token);
    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it('reset_avatar sets the app photo to the Telegram photo; without it the app photo is kept', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: 'https://cdn.example/custom.png' },
    });
    const kept = await patch({ display_name: 'Maya' }, token);
    expect(kept.json().avatar_url).toBe('https://cdn.example/custom.png');
    const reset = await patch({ display_name: 'Maya', reset_avatar: true }, token);
    expect(reset.json().avatar_url).toBe('https://t.me/i/userpic/320/maya.jpg');
  });

  it('answers 403 FORBIDDEN_ROLE for a CREATOR and writes nothing', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    const res = await patch({ display_name: 'Changed' }, token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).displayName).toBe(
      'Maya',
    );
    // A real role change (AccountSecurityService) also kills the old token.
    await security.changeRole(userId, 'USER');
    expect((await patch({ display_name: 'Changed' }, token)).statusCode).toBe(401);
  });

  it('rejects a blocked account and a stale session without writing', async () => {
    const { token, userId } = await signIn();
    await security.blockUser(userId);
    const res = await patch({ display_name: 'Changed' }, token);
    expect(res.statusCode).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).displayName).toBe(
      'Maya',
    );
  });

  it('rejects a session whose session_version is stale without writing', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    expect((await patch({ display_name: 'Changed' }, token)).statusCode).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).displayName).toBe(
      'Maya',
    );
  });

  it('rejects no token, garbage and an admin token', async () => {
    for (const bad of [undefined, 'garbage']) {
      expect((await patch({ display_name: 'x' }, bad)).statusCode).toBe(401);
    }
    const admin = await prisma.adminAccount.create({
      data: { username: 'root', passwordHash: 'x' },
    });
    const session = await prisma.session.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const adminToken = await signAccessToken(
      ACCESS,
      { adminId: admin.id, sessionId: session.id },
      new Date(),
      900,
    );
    expect((await patch({ display_name: 'x' }, adminToken)).statusCode).toBe(401);
  });
});
