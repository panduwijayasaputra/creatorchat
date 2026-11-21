import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  BroadcastSchema,
  ErrorResponseSchema,
  TelegramLoginResponseSchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const DAY = 86_400_000;

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 9700;
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
      USER_SESSION_SECRET: 'user-session-secret-'.padEnd(48, 'u'),
      ADMIN_ACCESS_TOKEN_SECRET: 'access-secret-'.padEnd(48, 'a'),
      ADMIN_REFRESH_TOKEN_SECRET: 'refresh-secret-'.padEnd(48, 'r'),
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
  for (const pattern of ['test:user:login:*', 'test:broadcast:create:*']) {
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
  `cbro${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

/** A signed-in creator with one active customer. */
async function setup(over: { subscribe?: boolean } = {}) {
  const login = await signIn();
  await prisma.user.update({ where: { id: login.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({
    data: { userId: login.userId, publicCode: code() },
  });
  if (over.subscribe !== false) {
    const customer = await signIn();
    await prisma.subscription.create({
      data: {
        customerId: customer.userId,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - 10 * DAY),
        endsAt: new Date(Date.now() + 10 * DAY),
      },
    });
  }
  return { login, creator };
}
type S = Awaited<ReturnType<typeof setup>>;

async function asset(
  creatorId: string,
  over: {
    purpose?: 'GALLERY' | 'BROADCAST' | 'CHAT';
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
      purpose: over.purpose ?? 'BROADCAST',
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
  if (over.gallery) {
    await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: 1 } });
  }
  return id;
}

const post = (token: string | undefined, payload: object) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/creator/broadcasts',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
const send = (s: S, assetId: string, extra: object = {}) =>
  post(s.login.token, {
    client_broadcast_id: randomUUID(),
    attachment: { asset_id: assetId },
    ...extra,
  });
const errorCode = (res: { json(): unknown }) => ErrorResponseSchema.parse(res.json()).code;
const events = () => prisma.outboxEvent.findMany({ where: { type: 'broadcast.created' } });

describe('POST /v1/creator/broadcasts', () => {
  it('201 with the id and status only; one broadcast and one event, nothing sent yet', async () => {
    const s = await setup();
    const id = await asset(s.creator.id, { purpose: 'GALLERY', gallery: true });
    const res = await send(s, id, { body: 'Promo hari ini' });
    expect(res.statusCode).toBe(201);
    const view = BroadcastSchema.parse(res.json());
    expect(view.status).toBe('QUEUED');
    expect(res.body).not.toMatch(/customer|recipient|asset|creator_id|object_key/);
    expect(await prisma.broadcast.count()).toBe(1);
    expect(await events()).toHaveLength(1);
    expect(await prisma.message.count()).toBe(0);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('save_to_gallery with an upload makes one gallery item; without the box none', async () => {
    const s = await setup();
    const plain = await asset(s.creator.id);
    expect((await send(s, plain)).statusCode).toBe(201);
    expect(await prisma.galleryItem.count({ where: { assetId: plain } })).toBe(0);
    const saved = await asset(s.creator.id);
    expect((await send(s, saved, { save_to_gallery: true })).statusCode).toBe(201);
    expect(await prisma.galleryItem.count({ where: { assetId: saved } })).toBe(1);
  });

  it('200 for a replay of the same client id, 409 IDEMPOTENCY_CONFLICT for different content', async () => {
    const s = await setup();
    const id = await asset(s.creator.id);
    const payload = { client_broadcast_id: randomUUID(), attachment: { asset_id: id } };
    const first = await post(s.login.token, payload);
    const again = await post(s.login.token, payload);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    const changed = await post(s.login.token, { ...payload, body: 'lain' });
    expect(changed.statusCode).toBe(409);
    expect(errorCode(changed)).toBe('IDEMPOTENCY_CONFLICT');
    expect(await prisma.broadcast.count()).toBe(1);
    expect(await events()).toHaveLength(1);
  });

  it('no token → 401; a customer → 403 FORBIDDEN_ROLE; a blocked creator account → 401', async () => {
    const s = await setup();
    const id = await asset(s.creator.id);
    expect(
      (await post(undefined, { client_broadcast_id: randomUUID(), attachment: { asset_id: id } }))
        .statusCode,
    ).toBe(401);

    const customer = await signIn();
    const forbidden = await post(customer.token, {
      client_broadcast_id: randomUUID(),
      attachment: { asset_id: id },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(errorCode(forbidden)).toBe('FORBIDDEN_ROLE');

    await prisma.user.update({ where: { id: s.login.userId }, data: { status: 'BLOCKED' } });
    expect((await send(s, id)).statusCode).toBe(401);
    expect(await prisma.broadcast.count()).toBe(0);
  });

  it('a blocked creator is refused with the common not-found', async () => {
    const s = await setup();
    const id = await asset(s.creator.id);
    await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
    const res = await send(s, id);
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
  });

  it("another creator's asset, a chat file and an unknown id all answer the same 404 MEDIA_NOT_FOUND", async () => {
    const s = await setup();
    const other = await setup();
    const foreign = await asset(other.creator.id);
    const chat = await asset(s.creator.id, { purpose: 'CHAT' }).catch(() => null);
    const bodies = new Set<string>();
    for (const id of [foreign, randomUUID(), ...(chat ? [chat] : [])]) {
      const res = await send(s, id);
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('MEDIA_NOT_FOUND');
      bodies.add(JSON.stringify({ ...(res.json() as object), request_id: '' }));
    }
    expect(bodies.size).toBe(1);
    expect(await prisma.broadcast.count()).toBe(0);
  });

  it('409 MEDIA_NOT_READY while processing, 409 NO_ACTIVE_SUBSCRIBERS without subscribers', async () => {
    const s = await setup();
    const pending = await asset(s.creator.id, { state: 'PENDING' });
    const res = await send(s, pending);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('MEDIA_NOT_READY');

    const empty = await setup({ subscribe: false });
    const ready = await asset(empty.creator.id);
    const none = await send(empty, ready);
    expect(none.statusCode).toBe(409);
    expect(errorCode(none)).toBe('NO_ACTIVE_SUBSCRIBERS');
  });

  it('400 for an unknown key, a missing attachment, a blank text and the box with a gallery file', async () => {
    const s = await setup();
    const upload = await asset(s.creator.id);
    const gallery = await asset(s.creator.id, { purpose: 'GALLERY', gallery: true });
    const base = { client_broadcast_id: randomUUID() };
    for (const payload of [
      { ...base, attachment: { asset_id: upload }, segment: 'vip' },
      base,
      { ...base, attachment: { asset_id: upload }, body: '   ' },
      { ...base, attachment: { asset_id: gallery }, save_to_gallery: true },
    ]) {
      const res = await post(s.login.token, payload);
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    }
    expect(await prisma.broadcast.count()).toBe(0);
  });

  it('429 after ten sends in a minute, with Retry-After', async () => {
    const s = await setup();
    for (let i = 0; i < 10; i++) {
      const id = await asset(s.creator.id);
      expect((await send(s, id)).statusCode).toBe(201);
    }
    const res = await send(s, await asset(s.creator.id));
    expect(res.statusCode).toBe(429);
    expect(errorCode(res)).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await prisma.broadcast.count()).toBe(10);
  });
});
