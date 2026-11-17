import { buildSignedInitData, loadEnv, LocalDiskStorage } from '@creatorchat/backend-core';
import {
  ADMIN_COOKIE,
  AdminGalleryResponseSchema,
  AdminMediaDetailSchema,
  ErrorResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import { hashPassword, type PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ADMIN_ORIGIN = 'http://localhost:5174';
const USER_ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const PASSWORD = 'a long enough password';
const SIGNING = 'local-signing-secret-'.padEnd(48, 's');

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;

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
let dir: string;
let storage: LocalDiskStorage;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  dir = await mkdtemp(path.join(tmpdir(), 'cc-api-admin-gallery-'));
  storage = new LocalDiskStorage(dir, SIGNING, 'http://localhost:3000');
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
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: dir,
      STORAGE_LOCAL_SIGNING_SECRET: SIGNING,
    }),
  );
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
  await rm(dir, { recursive: true, force: true });
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

async function telegramToken(id: number) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: USER_ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  return TelegramLoginResponseSchema.parse(res.json()).access_token;
}

let tgn = 920_000;
async function makeCreator(name = 'Salsa') {
  const user = await prisma.user.create({
    data: { telegramId: BigInt(tgn++), displayName: name, role: 'CREATOR' },
  });
  return prisma.creator.create({
    data: {
      userId: user.id,
      publicCode: `adm${'abcdefgh'[tgn % 8]}${'abcdefgh'[Math.floor(tgn / 8) % 8]}bbb`,
    },
  });
}

async function asset(
  creatorId: string,
  over: { seq?: number | null; state?: 'READY' | 'PROCESSING' } = {},
) {
  const id = randomUUID();
  const state = over.state ?? 'READY';
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: 'GALLERY',
      kind: 'PHOTO',
      state,
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      ...(state === 'READY'
        ? { mime: 'image/jpeg', sizeBytes: 2048n, thumbKey: `m/${creatorId}/${id}/thumb.webp` }
        : {}),
    },
  });
  if (over.seq != null) {
    await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: over.seq } });
  }
  const source = path.join(dir, `src-${id}`);
  await writeFile(source, Buffer.from(`file-${id}`));
  await storage.upload(`m/${creatorId}/${id}`, source, 'image/jpeg');
  await storage.upload(`m/${creatorId}/${id}/thumb.webp`, source, 'image/webp');
  return id;
}

const url = (creatorId: string, qs = '') => `/v1/admin/creators/${creatorId}/gallery${qs}`;
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

describe('GET /v1/admin/creators/:id/gallery', () => {
  it('lists the gallery newest upload first, read-only and no-store, with working thumbnails', async () => {
    const creator = await makeCreator();
    const first = await asset(creator.id, { seq: 1 });
    await asset(creator.id, { seq: 2 });
    const res = await admin.fetch('GET', url(creator.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = AdminGalleryResponseSchema.parse(await res.json());
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.number).sort()).toEqual([1, 2]);
    const thumb = await t.app.inject({
      method: 'GET',
      url: pathOf(body.items[0]?.thumbnail_url as string),
    });
    expect(thumb.statusCode).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/object_key|thumb_key|conversation|message_id/);
    expect(body.items.some((i) => i.asset_id === first)).toBe(true);
  });

  it('applies search, filters, sort and paging in the backend and refuses bad values with 400', async () => {
    const creator = await makeCreator();
    for (let seq = 1; seq <= 12; seq++) await asset(creator.id, { seq });
    const search = AdminGalleryResponseSchema.parse(
      await (await admin.fetch('GET', url(creator.id, '?q=%2312'))).json(),
    );
    expect(search.items.map((i) => i.number)).toEqual([12]);
    const paged = AdminGalleryResponseSchema.parse(
      await (
        await admin.fetch('GET', url(creator.id, '?sort=number&dir=asc&page=2&page_size=10'))
      ).json(),
    );
    expect(paged.items.map((i) => i.number)).toEqual([11, 12]);
    for (const qs of ['?sort=created_at', '?kind=AUDIO', '?page_size=100', '?page=0', '?x=1']) {
      expect((await admin.fetch('GET', url(creator.id, qs))).status).toBe(400);
    }
  });

  it('needs an admin session: none → 401, a user token → 401', async () => {
    const creator = await makeCreator();
    const anonymous = await fetch(`${base}${url(creator.id)}`, {
      headers: { origin: ADMIN_ORIGIN },
    });
    expect(anonymous.status).toBe(401);
    const userToken = await telegramToken(990_001);
    const asUser = await fetch(`${base}${url(creator.id)}`, {
      headers: { origin: ADMIN_ORIGIN, authorization: `Bearer ${userToken}` },
    });
    expect(asUser.status).toBe(401);
  });

  it('an unknown or malformed creator is 404, and a blocked creator is still viewable', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expect((await admin.fetch('GET', url(id))).status).toBe(404);
    }
    const creator = await makeCreator();
    await prisma.creator.update({ where: { id: creator.id }, data: { status: 'BLOCKED' } });
    expect((await admin.fetch('GET', url(creator.id))).status).toBe(200);
  });
});

describe('GET /v1/admin/creators/:id/gallery/:assetId', () => {
  it('returns the media with number, short id, creator and a preview link that serves the file', async () => {
    const creator = await makeCreator();
    const id = await asset(creator.id, { seq: 7 });
    const res = await admin.fetch('GET', `${url(creator.id)}/${id}`);
    expect(res.status).toBe(200);
    const detail = AdminMediaDetailSchema.parse(await res.json());
    expect(detail).toMatchObject({
      number: 7,
      kind: 'PHOTO',
      size_bytes: 2048,
      shown_in: 'GALLERY',
      poster_url: null,
    });
    expect(detail.creator).toEqual({ id: creator.id, display_name: 'Salsa' });
    expect(detail.short_id).toBe(`med_${id.replace(/-/g, '').slice(0, 7)}`);
    const file = await t.app.inject({ method: 'GET', url: pathOf(detail.preview.url) });
    expect(file.body).toBe(`file-${id}`);
    expect(JSON.stringify(detail)).not.toMatch(/object_key|conversation|message_id/);
  });

  it("answers 404 MEDIA_NOT_FOUND for a chat-only asset, another creator's gallery asset, PROCESSING and malformed ids", async () => {
    const creator = await makeCreator();
    const other = await makeCreator('Kirana');
    const chatOnly = await asset(creator.id, { seq: null });
    const processing = await asset(creator.id, { seq: null, state: 'PROCESSING' });
    const theirs = await asset(other.id, { seq: 1 });
    for (const id of [chatOnly, processing, theirs, randomUUID(), 'not-a-uuid']) {
      const res = await admin.fetch('GET', `${url(creator.id)}/${id}`);
      expect(res.status).toBe(404);
      expect(ErrorResponseSchema.parse(await res.json()).code).toBe('MEDIA_NOT_FOUND');
    }
    expect((await admin.fetch('GET', `${url(randomUUID())}/${theirs}`)).status).toBe(404);
  });
});
