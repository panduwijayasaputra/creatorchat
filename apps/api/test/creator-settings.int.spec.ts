import { AccountSecurityService, buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  CreatorLinkResponseSchema,
  CreatorSettingsResponseSchema,
  ErrorResponseSchema,
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
const PHOTO = 'https://t.me/i/userpic/320/s.jpg';

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let security: AccountSecurityService;
let nextTelegramId = 9800;
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

async function login(id: number, firstName: string, photo?: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: firstName, ...(photo ? { photo_url: photo } : {}) },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  return TelegramLoginResponseSchema.parse(res.json());
}

/** Signs in a customer, makes the account a creator (role + creators row), and signs in again. */
async function creatorSignIn(opts: { row?: boolean } = {}) {
  const id = nextTelegramId++;
  const first = await login(id, 'Salsa', PHOTO);
  await security.changeRole(first.user.id, 'CREATOR');
  const code = `k4m5x2q${String.fromCharCode(97 + nextCode++)}`;
  if (opts.row !== false) {
    await prisma.creator.create({ data: { userId: first.user.id, publicCode: code } });
  }
  const second = await login(id, 'Salsa', PHOTO);
  return { token: second.access_token, userId: first.user.id, code };
}

async function customerSignIn() {
  const body = await login(nextTelegramId++, 'Maya');
  return { token: body.access_token, userId: body.user.id };
}

const authed = (method: 'GET' | 'PATCH', url: string, token?: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const getSettings = (token?: string) => authed('GET', '/v1/creator/settings', token);
const patch = (payload: object, token?: string) =>
  authed('PATCH', '/v1/creator/profile', token, payload);
const nameOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).displayName;

describe('GET /v1/creator/settings', () => {
  it("returns the caller's own profile, public code and the bot link", async () => {
    const { token, userId, code } = await creatorSignIn();
    const res = await getSettings(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = CreatorSettingsResponseSchema.parse(res.json());
    expect(body.profile).toMatchObject({ id: userId, role: 'CREATOR' });
    expect(body.public_code).toBe(code);
    expect(body.bio_link).toBe(`https://t.me/TestBot?start=c_${code}`);
  });

  it('gives each creator only their own code', async () => {
    const a = await creatorSignIn();
    const b = await creatorSignIn();
    expect(
      CreatorSettingsResponseSchema.parse((await getSettings(a.token)).json()).public_code,
    ).toBe(a.code);
    expect(
      CreatorSettingsResponseSchema.parse((await getSettings(b.token)).json()).public_code,
    ).toBe(b.code);
  });

  it('403 FORBIDDEN_ROLE for a USER, 403 FORBIDDEN without a creators row, 401 without a session', async () => {
    const user = await customerSignIn();
    const res = await getSettings(user.token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    const noRow = await creatorSignIn({ row: false });
    const res2 = await getSettings(noRow.token);
    expect(res2.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res2.json()).code).toBe('FORBIDDEN');
    expect((await getSettings()).statusCode).toBe(401);
    expect((await getSettings('garbage')).statusCode).toBe(401);
  });

  it('rejects a blocked creator account and a blocked creators row', async () => {
    const a = await creatorSignIn();
    await security.blockUser(a.userId);
    expect((await getSettings(a.token)).statusCode).toBe(401);
    const b = await creatorSignIn();
    await prisma.creator.update({ where: { userId: b.userId }, data: { status: 'BLOCKED' } });
    expect((await getSettings(b.token)).statusCode).toBe(403);
  });
});

describe('PATCH /v1/creator/profile', () => {
  it('saves name and bio, and customers see them on the public lookup', async () => {
    const { token, userId, code } = await creatorSignIn();
    const res = await patch({ display_name: '  Salsa M ', bio: ' Suka masak ' }, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(UpdateProfileResponseSchema.parse(res.json())).toMatchObject({
      id: userId,
      display_name: 'Salsa M',
      bio: 'Suka masak',
    });
    const customer = await customerSignIn();
    const pub = await authed('GET', `/v1/creators/by-code/${code}`, customer.token);
    expect(CreatorLinkResponseSchema.parse(pub.json())).toMatchObject({
      display_name: 'Salsa M',
      bio: 'Suka masak',
    });
  });

  it('enforces the limits (40 / 160) and clears a blank bio', async () => {
    const { token } = await creatorSignIn();
    expect(
      (await patch({ display_name: 'a'.repeat(40), bio: 'b'.repeat(160) }, token)).statusCode,
    ).toBe(200);
    for (const bad of [
      { display_name: 'a'.repeat(41) },
      { display_name: 'a', bio: 'b'.repeat(161) },
      { display_name: ' ' },
      {},
    ]) {
      const res = await patch(bad, token);
      expect(res.statusCode).toBe(400);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    }
    expect((await patch({ display_name: 'Salsa', bio: '   ' }, token)).json().bio).toBeNull();
  });

  it('ignores ids, role, public_code and status; another creator is never touched', async () => {
    const a = await creatorSignIn();
    const b = await creatorSignIn();
    const res = await patch(
      {
        display_name: 'Only A',
        id: b.userId,
        user_id: b.userId,
        creator_id: 'x',
        public_code: 'aaaaaaaa',
        role: 'USER',
        status: 'BLOCKED',
        telegram_id: '1',
      },
      a.token,
    );
    expect(res.statusCode).toBe(200);
    const rowA = await prisma.user.findUniqueOrThrow({
      where: { id: a.userId },
      include: { creator: true },
    });
    expect(rowA).toMatchObject({ displayName: 'Only A', role: 'CREATOR', status: 'ACTIVE' });
    expect(rowA.creator?.publicCode).toBe(a.code);
    expect(await nameOf(b.userId)).toBe('Salsa');
  });

  it('reset_avatar restores the Telegram photo; otherwise the app photo is kept', async () => {
    const { token, userId } = await creatorSignIn();
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: 'https://cdn.example/c.png' },
    });
    expect((await patch({ display_name: 'S' }, token)).json().avatar_url).toBe(
      'https://cdn.example/c.png',
    );
    expect((await patch({ display_name: 'S', reset_avatar: true }, token)).json().avatar_url).toBe(
      PHOTO,
    );
  });

  it('403 FORBIDDEN_ROLE for a USER with nothing written; 401 for no token, blocked, stale', async () => {
    const user = await customerSignIn();
    const res = await patch({ display_name: 'Changed' }, user.token);
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    expect(await nameOf(user.userId)).toBe('Maya');
    expect((await patch({ display_name: 'x' })).statusCode).toBe(401);

    const blocked = await creatorSignIn();
    await security.blockUser(blocked.userId);
    expect((await patch({ display_name: 'Changed' }, blocked.token)).statusCode).toBe(401);
    expect(await nameOf(blocked.userId)).toBe('Salsa');

    const stale = await creatorSignIn();
    await prisma.user.update({
      where: { id: stale.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    expect((await patch({ display_name: 'Changed' }, stale.token)).statusCode).toBe(401);
    expect(await nameOf(stale.userId)).toBe('Salsa');
  });

  it('a blocked creators row is rejected without writing', async () => {
    const { token, userId } = await creatorSignIn();
    await prisma.creator.update({ where: { userId }, data: { status: 'BLOCKED' } });
    expect((await patch({ display_name: 'Changed' }, token)).statusCode).toBe(401);
    expect(await nameOf(userId)).toBe('Salsa');
  });

  it('the customer route stays closed to creators', async () => {
    const { token } = await creatorSignIn();
    expect((await authed('PATCH', '/v1/me/profile', token, { display_name: 'x' })).statusCode).toBe(
      403,
    );
  });
});
