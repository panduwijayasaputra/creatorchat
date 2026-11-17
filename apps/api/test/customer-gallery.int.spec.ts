import { buildSignedInitData, loadEnv, LocalDiskStorage } from '@creatorchat/backend-core';
import {
  CustomerGalleryItemDetailSchema,
  CustomerGalleryResponseSchema,
  ErrorResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const SIGNING = 'local-signing-secret-'.padEnd(48, 's');
const DAY = 86_400_000;

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let dir: string;
let storage: LocalDiskStorage;
let nextTelegramId = 9000;
let nextCode = 0;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  dir = await mkdtemp(path.join(tmpdir(), 'cc-api-customer-gallery-'));
  storage = new LocalDiskStorage(dir, SIGNING, 'http://localhost:3000');
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
  `gall${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

async function creatorWithGallery(count = 3) {
  const owner = await prisma.user.create({
    data: { telegramId: BigInt(nextTelegramId++), displayName: 'Salsa', role: 'CREATOR' },
  });
  const publicCode = code();
  const creator = await prisma.creator.create({ data: { userId: owner.id, publicCode } });
  const ids: string[] = [];
  for (let seq = 1; seq <= count; seq++) {
    const id = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id,
        creatorId: creator.id,
        clientUploadId: randomUUID(),
        purpose: 'GALLERY',
        kind: 'PHOTO',
        state: 'READY',
        objectKey: `m/${creator.id}/${id}`,
        declaredType: 'image/jpeg',
        declaredBytes: 10n,
        mime: 'image/jpeg',
        sizeBytes: 10n,
        thumbKey: `m/${creator.id}/${id}/thumb.webp`,
      },
    });
    await prisma.galleryItem.create({ data: { creatorId: creator.id, assetId: id, seq } });
    const source = path.join(dir, `src-${id}`);
    await writeFile(source, Buffer.from(`file-${id}`));
    await storage.upload(`m/${creator.id}/${id}`, source, 'image/jpeg');
    await storage.upload(`m/${creator.id}/${id}/thumb.webp`, source, 'image/webp');
    ids.push(id);
  }
  return { owner, creator, publicCode, ids };
}

const subscribe = (
  customerId: string,
  creatorId: string,
  over: { startsAt?: Date; endsAt?: Date; revokedAt?: Date } = {},
) =>
  prisma.subscription.create({
    data: {
      customerId,
      creatorId,
      startsAt: over.startsAt ?? new Date(Date.now() - 10 * DAY),
      endsAt: over.endsAt ?? new Date(Date.now() + 10 * DAY),
      revokedAt: over.revokedAt ?? null,
    },
  });

const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const listUrl = (c: string) => `/v1/creators/by-code/${c}/gallery`;
const itemUrl = (c: string, id: string) => `${listUrl(c)}/${id}`;
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

describe('access matrix', () => {
  it('an active subscriber gets the gallery, and the links serve the files', async () => {
    const g = await creatorWithGallery();
    const me = await signIn();
    await subscribe(me.userId, g.creator.id);
    const res = await get(listUrl(g.publicCode), me.token);
    expect(res.statusCode).toBe(200);
    const list = CustomerGalleryResponseSchema.parse(res.json());
    expect(list.items.map((i) => i.id)).toEqual([g.ids[2], g.ids[1], g.ids[0]]);
    expect(list.total).toBe(3);
    const thumb = await t.app.inject({
      method: 'GET',
      url: pathOf(list.items[0]?.thumbnail_url as string),
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/webp');

    const detail = CustomerGalleryItemDetailSchema.parse(
      (await get(itemUrl(g.publicCode, g.ids[1] as string), me.token)).json(),
    );
    expect([detail.position, detail.total, detail.previous_id, detail.next_id]).toEqual([
      2,
      3,
      g.ids[2],
      g.ids[0],
    ]);
    const file = await t.app.inject({ method: 'GET', url: pathOf(detail.original.url) });
    expect(file.body).toBe(`file-${g.ids[1]}`);
    const text = JSON.stringify([res.json(), detail]);
    expect(text).not.toMatch(/"state"|failure|object_key|thumb_key|creator_id|declared/);
  });

  it.each([
    ['a guest', async () => undefined],
    [
      'an expired subscriber',
      async (u: string, c: string) =>
        subscribe(u, c, {
          startsAt: new Date(Date.now() - 20 * DAY),
          endsAt: new Date(Date.now() - DAY),
        }),
    ],
    [
      'a revoked subscriber',
      async (u: string, c: string) => subscribe(u, c, { revokedAt: new Date(Date.now() - DAY) }),
    ],
    [
      'a customer with only a pending request',
      async (u: string, c: string) =>
        prisma.accessRequest.create({ data: { customerId: u, creatorId: c, type: 'TRIAL' } }),
    ],
  ])('%s gets 403 GALLERY_ACCESS_REQUIRED and no data on every route', async (_name, setup) => {
    const g = await creatorWithGallery();
    const me = await signIn();
    await setup(me.userId, g.creator.id);
    for (const url of [
      listUrl(g.publicCode),
      itemUrl(g.publicCode, g.ids[0] as string),
      itemUrl(g.publicCode, randomUUID()),
      itemUrl(g.publicCode, 'not-a-uuid'),
    ]) {
      const res = await get(url, me.token);
      expect(res.statusCode).toBe(403);
      const body = ErrorResponseSchema.parse(res.json());
      expect(body.code).toBe('GALLERY_ACCESS_REQUIRED');
      expect(Object.keys(res.json() as object).sort()).toEqual(['code', 'message', 'request_id']);
      expect(res.body).not.toContain(g.ids[0] as string);
    }
  });

  it('a CREATOR token is 403 FORBIDDEN_ROLE, a blocked customer and no token are 401', async () => {
    const g = await creatorWithGallery();
    const creatorSession = await signIn();
    await prisma.user.update({ where: { id: creatorSession.userId }, data: { role: 'CREATOR' } });
    expect(
      ErrorResponseSchema.parse((await get(listUrl(g.publicCode), creatorSession.token)).json())
        .code,
    ).toBe('FORBIDDEN_ROLE');
    const blocked = await signIn();
    await subscribe(blocked.userId, g.creator.id);
    await prisma.user.update({ where: { id: blocked.userId }, data: { status: 'BLOCKED' } });
    expect((await get(listUrl(g.publicCode), blocked.token)).statusCode).toBe(401);
    expect((await get(listUrl(g.publicCode))).statusCode).toBe(401);
  });

  it('unknown, malformed, blocked-creator codes are the same 404 CREATOR_NOT_FOUND', async () => {
    const g = await creatorWithGallery();
    const me = await signIn();
    await subscribe(me.userId, g.creator.id);
    await prisma.creator.update({ where: { id: g.creator.id }, data: { status: 'BLOCKED' } });
    for (const c of [g.publicCode, 'zzzzzzzz', 'nope', '..%2Fx']) {
      for (const url of [listUrl(c), itemUrl(c, randomUUID())]) {
        const res = await get(url, me.token);
        expect(res.statusCode).toBe(404);
        expect(ErrorResponseSchema.parse(res.json()).code).toBe('CREATOR_NOT_FOUND');
      }
    }
  });

  it("an entitled subscriber gets 404 MEDIA_NOT_FOUND for another creator's asset and malformed ids", async () => {
    const mine = await creatorWithGallery(1);
    const other = await creatorWithGallery(1);
    const me = await signIn();
    await subscribe(me.userId, mine.creator.id);
    for (const id of [other.ids[0] as string, 'not-a-uuid', randomUUID()]) {
      const res = await get(itemUrl(mine.publicCode, id), me.token);
      expect(res.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('MEDIA_NOT_FOUND');
    }
    expect((await get(listUrl(other.publicCode), me.token)).statusCode).toBe(403);
  });

  it('access ending mid-session turns the next call into 403', async () => {
    const g = await creatorWithGallery(1);
    const me = await signIn();
    const sub = await subscribe(me.userId, g.creator.id);
    expect((await get(listUrl(g.publicCode), me.token)).statusCode).toBe(200);
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    expect((await get(listUrl(g.publicCode), me.token)).statusCode).toBe(403);
  });
});

describe('the profile endpoint stays media-free', () => {
  it('returns no media field for an active subscriber', async () => {
    const g = await creatorWithGallery();
    const me = await signIn();
    await subscribe(me.userId, g.creator.id);
    const res = await get(`/v1/creators/by-code/${g.publicCode}`, me.token);
    expect(res.statusCode).toBe(200);
    const keys = Object.keys(res.json() as object).sort();
    expect(
      keys.every((k) =>
        [
          'access',
          'avatar_url',
          'bio',
          'conversation_id',
          'display_name',
          'last_review',
          'public_code',
        ].includes(k),
      ),
    ).toBe(true);
    expect(res.body).not.toMatch(/thumbnail|gallery|dev-storage/);
  });
});
