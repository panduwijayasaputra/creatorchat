import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  CreatorSettingsResponseSchema,
  ErrorResponseSchema,
  TelegramLoginResponseSchema,
  WelcomeMessageResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const SIGNING = 'local-signing-secret-'.padEnd(48, 's');

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let dir: string;
let nextTelegramId = 10_300;
let nextCode = 0;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  dir = await mkdtemp(path.join(tmpdir(), 'cc-api-welcome-'));
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: process.env.REDIS_URL,
      ALLOWED_ORIGINS: ORIGIN,
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_BOT_USERNAME: 'TestBot',
      USER_SESSION_SECRET: 'user-session-secret-'.padEnd(48, 'u'),
      ADMIN_ACCESS_TOKEN_SECRET: 'access-secret-'.padEnd(48, 'a'),
      ADMIN_REFRESH_TOKEN_SECRET: 'refresh-secret-'.padEnd(48, 'r'),
      COOKIE_SECURE: 'false',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: dir,
      STORAGE_LOCAL_SIGNING_SECRET: SIGNING,
    }),
  );
});
afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDatabase(prisma);
  const keys = await redis.keys('test:user:login:*');
  if (keys.length > 0) await redis.del(...keys);
});

async function signIn(): Promise<{ token: string; userId: string }> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id: nextTelegramId++, first_name: 'Nadia' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

const code = () =>
  `wlcm${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

async function creatorOf(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const login = await signIn();
  await prisma.user.update({ where: { id: login.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({
    data: { userId: login.userId, publicCode: code(), status },
  });
  return { login, creator };
}

async function asset(
  creatorId: string,
  over: {
    purpose?: 'GALLERY' | 'WELCOME' | 'BROADCAST';
    gallery?: boolean;
    state?: 'READY' | 'PENDING';
  } = {},
) {
  const id = randomUUID();
  const state = over.state ?? 'READY';
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: over.purpose ?? 'WELCOME',
      kind: 'PHOTO',
      state,
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      ...(state === 'READY'
        ? { mime: 'image/jpeg', sizeBytes: 10n, thumbKey: `m/${creatorId}/${id}/thumb.webp` }
        : {}),
    },
  });
  if (over.gallery) await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: 1 } });
  return id;
}

const URL = '/v1/creator/welcome-message';
const call = (method: 'GET' | 'PUT', token?: string, payload?: object) =>
  t.app.inject({
    method,
    url: URL,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const errorCode = (res: { json(): unknown }) => ErrorResponseSchema.parse(res.json()).code;

describe('GET and PUT /v1/creator/welcome-message', () => {
  it('answers off and empty first, no-store, and writes nothing', async () => {
    const { login } = await creatorOf();
    const res = await call('GET', login.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(WelcomeMessageResponseSchema.parse(res.json())).toEqual({
      enabled: false,
      body: '',
      media: null,
    });
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });

  it('PUT saves text and a gallery file; a GET shows the same, with no storage key anywhere', async () => {
    const { login, creator } = await creatorOf();
    const id = await asset(creator.id, { purpose: 'GALLERY', gallery: true });
    const put = await call('PUT', login.token, {
      enabled: true,
      body: ' Halo, selamat datang! ',
      asset_id: id,
    });
    expect(put.statusCode).toBe(200);
    const saved = WelcomeMessageResponseSchema.parse(put.json());
    expect(saved).toMatchObject({
      enabled: true,
      body: 'Halo, selamat datang!',
      media: { asset_id: id, kind: 'PHOTO', source: 'GALLERY' },
    });
    expect(WelcomeMessageResponseSchema.parse((await call('GET', login.token)).json())).toEqual(
      saved,
    );
    const withoutLinks = put.body.replace(/"thumbnail_url":"[^"]*"/g, '"thumbnail_url":"[link]"');
    expect(withoutLinks).not.toMatch(/object_key|thumb_key|m\//);
  });

  it('PUT with an upload made for the welcome message shows UPLOAD, and the upload stays out of the gallery; a repeat is identical', async () => {
    const { login, creator } = await creatorOf();
    const id = await asset(creator.id);
    const body = { enabled: true, body: 'Halo', asset_id: id };
    const first = await call('PUT', login.token, body);
    const again = await call('PUT', login.token, body);
    expect(WelcomeMessageResponseSchema.parse(first.json()).media?.source).toBe('UPLOAD');
    expect(again.json()).toEqual(first.json());
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(await prisma.creatorWelcomeMessage.count()).toBe(1);
  });

  it('the settings show whether it is switched on', async () => {
    const { login } = await creatorOf();
    const read = async () =>
      CreatorSettingsResponseSchema.parse(
        (
          await t.app.inject({
            method: 'GET',
            url: '/v1/creator/settings',
            headers: { authorization: `Bearer ${login.token}` },
          })
        ).json(),
      ).welcome_enabled;
    expect(await read()).toBe(false);
    await call('PUT', login.token, { enabled: true, body: 'Halo', asset_id: null });
    expect(await read()).toBe(true);
    await call('PUT', login.token, { enabled: false, body: 'Halo', asset_id: null });
    expect(await read()).toBe(false);
  });

  it('no token 401, a customer 403 FORBIDDEN_ROLE, a blocked account 401, a blocked creator 404', async () => {
    expect((await call('GET')).statusCode).toBe(401);
    expect(
      (await call('PUT', undefined, { enabled: false, body: '', asset_id: null })).statusCode,
    ).toBe(401);
    const customer = await signIn();
    for (const res of [
      await call('GET', customer.token),
      await call('PUT', customer.token, { enabled: false, body: '', asset_id: null }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN_ROLE');
    }
    const blocked = await creatorOf('BLOCKED');
    const res = await call('PUT', blocked.login.token, {
      enabled: true,
      body: 'Halo',
      asset_id: null,
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
    const account = await creatorOf();
    await prisma.user.update({ where: { id: account.login.userId }, data: { status: 'BLOCKED' } });
    expect((await call('GET', account.login.token)).statusCode).toBe(401);
  });

  it("another creator's file, a broadcast file and an unknown id answer the same 404 MEDIA_NOT_FOUND", async () => {
    const mine = await creatorOf();
    const other = await creatorOf();
    const bodies = new Set<string>();
    for (const id of [
      await asset(other.creator.id),
      await asset(mine.creator.id, { purpose: 'BROADCAST' }),
      randomUUID(),
    ]) {
      const res = await call('PUT', mine.login.token, {
        enabled: true,
        body: 'Halo',
        asset_id: id,
      });
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('MEDIA_NOT_FOUND');
      bodies.add(JSON.stringify({ ...(res.json() as object), request_id: '' }));
    }
    expect(bodies.size).toBe(1);
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });

  it('409 MEDIA_NOT_READY while the file is processed; 400 for the switch on without text, an unknown key and a missing key', async () => {
    const { login, creator } = await creatorOf();
    const pending = await asset(creator.id, { state: 'PENDING' });
    const notReady = await call('PUT', login.token, {
      enabled: true,
      body: 'Halo',
      asset_id: pending,
    });
    expect(notReady.statusCode).toBe(409);
    expect(errorCode(notReady)).toBe('MEDIA_NOT_READY');
    for (const payload of [
      { enabled: true, body: '   ', asset_id: null },
      { enabled: true, body: 'Halo', asset_id: null, creator_id: randomUUID() },
      { enabled: true, body: 'Halo' },
      { enabled: 'yes', body: 'Halo', asset_id: null },
    ]) {
      const res = await call('PUT', login.token, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    }
    expect(await prisma.creatorWelcomeMessage.count()).toBe(0);
  });
});
