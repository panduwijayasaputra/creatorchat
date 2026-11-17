import { buildSignedInitData, loadEnv, type MediaUploadService } from '@creatorchat/backend-core';
import {
  CreatorGalleryItemDetailSchema,
  CreatorGalleryResponseSchema,
  ErrorResponseSchema,
  MediaAssetResponseSchema,
  MediaLimitsSchema,
  MediaUploadInitResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEDIA_UPLOAD } from '../src/modules/media/tokens.js';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const USER_SECRET = 'user-session-secret-'.padEnd(48, 'u');
const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');
const SIGNING = 'local-signing-secret-'.padEnd(48, 's');

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let dir: string;
let nextTelegramId = 8000;
let nextCode = 0;

const baseEnv = () => ({
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
});

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  dir = await mkdtemp(path.join(tmpdir(), 'cc-api-media-'));
  t = await buildTestApp(
    loadEnv({
      ...baseEnv(),
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
  for (const pattern of ['test:user:login:*', 'test:media:init:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
});

async function signIn(): Promise<{ token: string; userId: string }> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id: nextTelegramId++, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

const code = () =>
  `medi${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

async function creatorSession() {
  const me = await signIn();
  await prisma.user.update({ where: { id: me.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({ data: { userId: me.userId, publicCode: code() } });
  return { ...me, creator };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(996, 1)]);

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });

const initBody = (over: Record<string, unknown> = {}) => ({
  client_upload_id: randomUUID(),
  kind: 'PHOTO',
  content_type: 'image/jpeg',
  size_bytes: 1000,
  ...over,
});

const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

async function initUpload(token: string, over: Record<string, unknown> = {}) {
  const res = await call('POST', '/v1/creator/media/uploads', token, initBody(over));
  expect([200, 201]).toContain(res.statusCode);
  return { res, body: MediaUploadInitResponseSchema.parse(res.json()) };
}

const putTo = (url: string, body: Buffer, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'PUT',
    url: pathOf(url),
    headers: { 'content-type': 'image/jpeg', ...headers },
    payload: body,
  });

describe('roles and sessions', () => {
  it('no token → 401; USER → 403 FORBIDDEN_ROLE; blocked account → 401', async () => {
    const c = await creatorSession();
    const id = randomUUID();
    const routes = [
      ['GET', '/v1/creator/media/limits'],
      ['POST', '/v1/creator/media/uploads'],
      ['POST', `/v1/creator/media/uploads/${id}/complete`],
      ['GET', `/v1/creator/media/${id}`],
      ['GET', '/v1/creator/gallery'],
    ] as const;
    const user = await signIn();
    for (const [method, url] of routes) {
      expect((await call(method, url)).statusCode).toBe(401);
      const res = await call(method, url, user.token, method === 'POST' ? {} : undefined);
      expect(res.statusCode).toBe(403);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('FORBIDDEN_ROLE');
    }
    await prisma.user.update({ where: { id: c.userId }, data: { status: 'BLOCKED' } });
    expect((await call('GET', '/v1/creator/gallery', c.token)).statusCode).toBe(401);
  });

  it('a blocked creator row cannot start an upload (403 CREATOR_NOT_ACTIVE)', async () => {
    const c = await creatorSession();
    await prisma.creator.update({ where: { id: c.creator.id }, data: { status: 'BLOCKED' } });
    const res = await call('POST', '/v1/creator/media/uploads', c.token, initBody());
    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('CREATOR_NOT_ACTIVE');
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});

describe('upload flow', () => {
  it('limits → init → signed PUT → complete → PROCESSING; the gallery stays empty until the worker finishes', async () => {
    const c = await creatorSession();
    const limits = MediaLimitsSchema.parse(
      (await call('GET', '/v1/creator/media/limits', c.token)).json(),
    );
    expect(limits).toEqual({
      photo_max_bytes: 10_485_760,
      video_max_bytes: 209_715_200,
      video_max_seconds: 300,
    });

    const { res, body } = await initUpload(c.token);
    expect(res.statusCode).toBe(201);
    expect(body.asset.state).toBe('PENDING');
    const upload = body.upload;
    if (!upload) throw new Error('no upload');

    // Without the file, completing is a 409 and nothing changes.
    const early = await call(
      'POST',
      `/v1/creator/media/uploads/${body.asset.id}/complete`,
      c.token,
    );
    expect(early.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(early.json()).code).toBe('MEDIA_UPLOAD_INCOMPLETE');

    expect((await putTo(upload.url, JPEG, upload.headers)).statusCode).toBe(200);
    const done = await call('POST', `/v1/creator/media/uploads/${body.asset.id}/complete`, c.token);
    expect(done.statusCode).toBe(200);
    expect(MediaAssetResponseSchema.parse(done.json()).asset.state).toBe('PROCESSING');

    const polled = await call('GET', `/v1/creator/media/${body.asset.id}`, c.token);
    expect(MediaAssetResponseSchema.parse(polled.json()).asset.state).toBe('PROCESSING');
    const empty = CreatorGalleryResponseSchema.parse(
      (await call('GET', '/v1/creator/gallery', c.token)).json(),
    );
    expect(empty).toEqual({ items: [], total: 0, next_cursor: null });

    // The worker step, run directly: the gallery then shows the item with a signed thumbnail.
    const service = t.app.get<MediaUploadService>(MEDIA_UPLOAD, { strict: false });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: body.asset.id } });
    const thumb = `${row.objectKey}/thumb.webp`;
    const source = path.join(dir, 'thumb-src');
    await writeFile(source, Buffer.from('RIFF....WEBPthumb'));
    const storage = (
      service as unknown as {
        deps: { storage: { upload(k: string, s: string, t: string): Promise<void> } };
      }
    ).deps.storage;
    await storage.upload(thumb, source, 'image/webp');
    await service.markProcessed(row.id, {
      mime: 'image/jpeg',
      sizeBytes: 900,
      width: 8,
      height: 8,
      durationMs: null,
      thumbKey: thumb,
    });

    const gallery = CreatorGalleryResponseSchema.parse(
      (await call('GET', '/v1/creator/gallery', c.token)).json(),
    );
    expect(gallery.total).toBe(1);
    const item = gallery.items[0];
    expect(item?.asset.state).toBe('READY');
    const url = item?.asset.thumbnail_url;
    if (!url) throw new Error('no thumbnail');
    const got = await t.app.inject({ method: 'GET', url: pathOf(url) });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toContain('image/webp');
    expect(got.body).toBe('RIFF....WEBPthumb');
  });

  it('a repeated init with the same client_upload_id answers 200 with the same asset', async () => {
    const c = await creatorSession();
    const clientUploadId = randomUUID();
    const a = await initUpload(c.token, { client_upload_id: clientUploadId });
    const b = await initUpload(c.token, { client_upload_id: clientUploadId });
    expect(a.res.statusCode).toBe(201);
    expect(b.res.statusCode).toBe(200);
    expect(b.body.asset.id).toBe(a.body.asset.id);
  });

  it('refuses a wrong type, a too large file and an invalid body', async () => {
    const c = await creatorSession();
    const big = await call(
      'POST',
      '/v1/creator/media/uploads',
      c.token,
      initBody({ size_bytes: 10_485_761 }),
    );
    expect(big.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(big.json()).code).toBe('MEDIA_TOO_LARGE');
    const mismatch = await call(
      'POST',
      '/v1/creator/media/uploads',
      c.token,
      initBody({ kind: 'VIDEO' }),
    );
    expect(mismatch.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(mismatch.json()).code).toBe('VALIDATION_FAILED');
    const extra = await call(
      'POST',
      '/v1/creator/media/uploads',
      c.token,
      initBody({ object_key: 'm/x' }),
    );
    expect(extra.statusCode).toBe(400);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it('answers 429 MEDIA_RATE_LIMITED with Retry-After on the 31st init', async () => {
    const c = await creatorSession();
    for (let i = 0; i < 30; i++) {
      expect(
        (await call('POST', '/v1/creator/media/uploads', c.token, initBody())).statusCode,
      ).toBe(201);
    }
    const res = await call('POST', '/v1/creator/media/uploads', c.token, initBody());
    expect(res.statusCode).toBe(429);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('MEDIA_RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it("another creator's asset and a malformed id are the same 404", async () => {
    const a = await creatorSession();
    const b = await creatorSession();
    const { body } = await initUpload(a.token);
    for (const [method, url] of [
      ['GET', `/v1/creator/media/${body.asset.id}`],
      ['POST', `/v1/creator/media/uploads/${body.asset.id}/complete`],
      ['GET', `/v1/creator/media/${randomUUID()}`],
      ['GET', '/v1/creator/media/not-a-uuid'],
      ['POST', '/v1/creator/media/uploads/not-a-uuid/complete'],
    ] as const) {
      const res = await call(method, url, b.token, method === 'POST' ? {} : undefined);
      expect(res.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('MEDIA_NOT_FOUND');
    }
    expect((await call('GET', '/v1/creator/gallery', b.token)).json()).toEqual({
      items: [],
      total: 0,
      next_cursor: null,
    });
  });

  it('responses never carry storage keys or object paths in their fields', async () => {
    const c = await creatorSession();
    const { res } = await initUpload(c.token);
    const text = JSON.stringify(res.json());
    expect(text).not.toMatch(/object_key|thumb_key|objectKey|declared/);
    expect(Object.keys((res.json() as { asset: object }).asset).sort()).toEqual([
      'created_at',
      'duration_seconds',
      'failure',
      'id',
      'kind',
      'state',
      'thumbnail_url',
    ]);
  });
});

describe('dev storage', () => {
  async function pending(token: string) {
    const { body } = await initUpload(token);
    if (!body.upload) throw new Error('no upload');
    return { id: body.asset.id, upload: body.upload };
  }
  const files = async () => {
    try {
      return (await readdir(dir, { recursive: true })).filter((f) => !f.endsWith('thumb-src'));
    } catch {
      return [];
    }
  };

  it.each([
    ['a tampered signature', (u: URL) => u.searchParams.set('s', 'a'.repeat(64))],
    ['a longer declared length', (u: URL) => u.searchParams.set('l', '1001')],
    ['a different content type', (u: URL) => u.searchParams.set('t', 'image/png')],
    [
      'a later expiry',
      (u: URL) => u.searchParams.set('e', String(Math.floor(Date.now() / 1000) + 99999)),
    ],
    ['the GET method', (u: URL) => u.searchParams.set('m', 'GET')],
  ])('refuses a PUT with %s and writes nothing', async (_name, tamper) => {
    const c = await creatorSession();
    const { upload } = await pending(c.token);
    const url = new URL(upload.url);
    tamper(url);
    const before = await files();
    const res = await putTo(url.toString(), JPEG, upload.headers);
    expect(res.statusCode).toBe(403);
    expect(await files()).toEqual(before);
  });

  it('refuses a body whose length or type differs from the signed ones', async () => {
    const c = await creatorSession();
    const { upload } = await pending(c.token);
    const before = await files();
    const short = await putTo(upload.url, JPEG.subarray(0, 500));
    expect(short.statusCode).toBe(400);
    const wrongType = await putTo(upload.url, JPEG, { 'content-type': 'image/png' });
    expect([400, 415]).toContain(wrongType.statusCode);
    expect(await files()).toEqual(before);
  });

  it('refuses an expired link', async () => {
    const c = await creatorSession();
    const { upload } = await pending(c.token);
    const url = new URL(upload.url);
    // Re-sign nothing: just move the clock by editing expiry into the past, which breaks the signature too.
    url.searchParams.set('e', String(Math.floor(Date.now() / 1000) - 10));
    expect((await putTo(url.toString(), JPEG, upload.headers)).statusCode).toBe(403);
  });

  it('serves a single Range as 206 with the right bytes, and a plain GET in full', async () => {
    const c = await creatorSession();
    const service = t.app.get<MediaUploadService>(MEDIA_UPLOAD, { strict: false });
    const { id, upload } = await pending(c.token);
    expect((await putTo(upload.url, JPEG, upload.headers)).statusCode).toBe(200);
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
    const storage = (
      service as unknown as {
        deps: {
          storage: {
            presignGet(
              k: string,
              o: { expiresInSeconds: number; contentType: string },
            ): Promise<string>;
          };
        };
      }
    ).deps.storage;
    const getUrl = await storage.presignGet(row.objectKey, {
      expiresInSeconds: 60,
      contentType: 'image/jpeg',
    });

    const full = await t.app.inject({ method: 'GET', url: pathOf(getUrl) });
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals(JPEG)).toBe(true);
    expect(full.headers['accept-ranges']).toBe('bytes');

    const range = await t.app.inject({
      method: 'GET',
      url: pathOf(getUrl),
      headers: { range: 'bytes=2-5' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.headers['content-range']).toBe('bytes 2-5/1000');
    expect(range.rawPayload.equals(JPEG.subarray(2, 6))).toBe(true);

    const bad = await t.app.inject({
      method: 'GET',
      url: pathOf(getUrl),
      headers: { range: 'bytes=5000-6000' },
    });
    expect(bad.statusCode).toBe(416);

    const tampered = new URL(getUrl);
    tampered.searchParams.set('s', 'b'.repeat(64));
    expect(
      (await t.app.inject({ method: 'GET', url: pathOf(tampered.toString()) })).statusCode,
    ).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: pathOf(upload.url) })).statusCode).toBe(403); // PUT link used for GET
  });

  it('is not registered when the driver is r2, and the API still reports media endpoints', async () => {
    const r2 = await buildTestApp(
      loadEnv({
        ...baseEnv(),
        STORAGE_DRIVER: 'r2',
        // No login secrets: the realtime gateway stays off in this short-lived app.
        USER_SESSION_SECRET: undefined,
        TELEGRAM_BOT_TOKEN: undefined,
        R2_ACCOUNT_ENDPOINT: 'https://acct.r2.example.test',
        R2_BUCKET: 'bucket',
        R2_ACCESS_KEY_ID: 'AKID',
        R2_SECRET_ACCESS_KEY: 'SECRET',
      }),
    );
    try {
      const res = await r2.app.inject({
        method: 'GET',
        url: `/v1/dev-storage/m/${randomUUID()}/${randomUUID()}?m=GET&e=1&l=0&t=x&s=00`,
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await r2.app.close();
    }
  });
});

describe('gallery item detail', () => {
  async function readyItem(token: string) {
    const { body } = await initUpload(token);
    if (!body.upload) throw new Error('no upload');
    await putTo(body.upload.url, JPEG, body.upload.headers);
    await call('POST', `/v1/creator/media/uploads/${body.asset.id}/complete`, token);
    const service = t.app.get<MediaUploadService>(MEDIA_UPLOAD, { strict: false });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: body.asset.id } });
    await service.markProcessed(row.id, {
      mime: 'image/jpeg',
      sizeBytes: 1000,
      width: 8,
      height: 8,
      durationMs: null,
      thumbKey: `${row.objectKey}/thumb.webp`,
    });
    return body.asset.id;
  }

  it('returns the item with position, neighbours and a signed link that serves the file', async () => {
    const c = await creatorSession();
    const first = await readyItem(c.token);
    const second = await readyItem(c.token);
    const res = await call('GET', `/v1/creator/gallery/${first}`, c.token);
    expect(res.statusCode).toBe(200);
    const detail = CreatorGalleryItemDetailSchema.parse(res.json());
    expect([detail.position, detail.total, detail.previous_id, detail.next_id]).toEqual([
      2,
      2,
      second,
      null,
    ]);
    const file = await t.app.inject({ method: 'GET', url: pathOf(detail.original.url) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('image/jpeg');
    expect(file.rawPayload.equals(JPEG)).toBe(true);
    expect(JSON.stringify(res.json())).not.toMatch(/object_key|objectKey|thumb_key/);
  });

  it('answers 404 for another creator, a PROCESSING asset and a malformed id; 403 for a USER; 401 without a token', async () => {
    const a = await creatorSession();
    const b = await creatorSession();
    const id = await readyItem(a.token);
    const { body: processing } = await initUpload(a.token);
    for (const [token, target] of [
      [b.token, id],
      [a.token, processing.asset.id],
      [a.token, 'not-a-uuid'],
      [a.token, randomUUID()],
    ] as const) {
      const res = await call('GET', `/v1/creator/gallery/${target}`, token);
      expect(res.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('MEDIA_NOT_FOUND');
    }
    const user = await signIn();
    expect((await call('GET', `/v1/creator/gallery/${id}`, user.token)).statusCode).toBe(403);
    expect((await call('GET', `/v1/creator/gallery/${id}`)).statusCode).toBe(401);
  });
});
