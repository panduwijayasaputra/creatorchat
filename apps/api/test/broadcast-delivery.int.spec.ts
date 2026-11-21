import {
  BroadcastFanOutService,
  BroadcastProcessor,
  BroadcastService,
  buildSignedInitData,
  loadEnv,
  LocalDiskStorage,
  OutboxService,
} from '@creatorchat/backend-core';
import {
  ChatHistoryResponseSchema,
  ChatMediaDetailSchema,
  ChatUnreadResponseSchema,
  CreatorChatHistoryResponseSchema,
  CreatorGalleryResponseSchema,
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
const TEXT = 'Promo hari ini, khusus subscriber.';

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let dir: string;
let storage: LocalDiskStorage;
let nextTelegramId = 9900;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  dir = await mkdtemp(path.join(tmpdir(), 'cc-api-broadcast-'));
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

/** A creator, two active customers, one expired customer, and a broadcast already delivered. */
async function delivered() {
  const creatorLogin = await signIn();
  await prisma.user.update({
    where: { id: creatorLogin.userId },
    data: { role: 'CREATOR', displayName: 'Salsa Maheswari' },
  });
  const creator = await prisma.creator.create({
    data: { userId: creatorLogin.userId, publicCode: 'brdcasta' },
  });
  const customer = async (endsInDays: number) => {
    const login = await signIn();
    await prisma.subscription.create({
      data: {
        customerId: login.userId,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - 30 * DAY),
        endsAt: new Date(Date.now() + endsInDays * DAY),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { customerId: login.userId, creatorId: creator.id },
    });
    return { ...login, conversation };
  };
  const first = await customer(10);
  const second = await customer(10);
  const expired = await customer(-1);

  const assetId = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      creatorId: creator.id,
      clientUploadId: randomUUID(),
      purpose: 'BROADCAST',
      kind: 'PHOTO',
      state: 'READY',
      objectKey: `m/${creator.id}/${assetId}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      mime: 'image/jpeg',
      sizeBytes: 10n,
      thumbKey: `m/${creator.id}/${assetId}/thumb.webp`,
    },
  });
  const source = path.join(dir, `src-${assetId}`);
  await writeFile(source, Buffer.from(`file-${assetId}`));
  await storage.upload(`m/${creator.id}/${assetId}`, source, 'image/jpeg');
  await storage.upload(`m/${creator.id}/${assetId}/thumb.webp`, source, 'image/webp');

  const outbox = new OutboxService();
  const r = await new BroadcastService(prisma, outbox).create(creatorLogin.userId, {
    clientBroadcastId: randomUUID(),
    assetId,
    body: TEXT,
    saveToGallery: false,
  });
  if (r.kind !== 'created') throw new Error(r.kind);
  const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'broadcast.created' } });
  const outcome = await new BroadcastProcessor(
    prisma,
    new BroadcastFanOutService(prisma, outbox),
  ).run(event.id, { budgetMs: 10_000 });
  expect(outcome).toBe('done');
  return { creatorLogin, creator, first, second, expired, assetId };
}

const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

describe('a delivered broadcast, as the customers see it', () => {
  it('shows an active subscriber a normal creator media message, counts it unread, and opens its file', async () => {
    const d = await delivered();
    const res = await get(`/v1/chats/${d.first.conversation.id}/messages`, d.first.token);
    expect(res.statusCode).toBe(200);
    const history = ChatHistoryResponseSchema.parse(res.json());
    expect(history.items).toHaveLength(1);
    const message = history.items[0]!;
    expect(message).toMatchObject({ type: 'MEDIA', body: TEXT });
    expect(message.attachments).toHaveLength(1);
    // a broadcast looks like any message: no label, no broadcast id, no origin, no asset id
    // (the signed thumbnail link is the one place a path appears; the ids are the attachment's)
    const bodyWithoutLinks = res.body.replace(
      /"thumbnail_url":"[^"]*"/g,
      '"thumbnail_url":"[link]"',
    );
    expect(bodyWithoutLinks).not.toMatch(/broadcast|origin|asset_id|object_key|thumb_key/i);
    expect(bodyWithoutLinks).not.toContain(d.assetId);

    const unread = ChatUnreadResponseSchema.parse(
      (await get('/v1/chats/unread', d.first.token)).json(),
    );
    expect(unread.unread_total).toBe(1);

    const attachmentId = message.attachments[0]!.id;
    const open = await get(
      `/v1/chats/${d.first.conversation.id}/media/${attachmentId}`,
      d.first.token,
    );
    expect(open.statusCode).toBe(200);
    const detail = ChatMediaDetailSchema.parse(open.json());
    expect(detail.message.body).toBe(TEXT);
    const file = await t.app.inject({ method: 'GET', url: pathOf(detail.original.url) });
    expect(file.body).toBe(`file-${d.assetId}`);
  });

  it("every recipient has the same file in its own message, and nobody can open another recipient's attachment", async () => {
    const d = await delivered();
    const a = ChatHistoryResponseSchema.parse(
      (await get(`/v1/chats/${d.first.conversation.id}/messages`, d.first.token)).json(),
    );
    const b = ChatHistoryResponseSchema.parse(
      (await get(`/v1/chats/${d.second.conversation.id}/messages`, d.second.token)).json(),
    );
    const aAttachment = a.items[0]!.attachments[0]!.id;
    const bAttachment = b.items[0]!.attachments[0]!.id;
    expect(aAttachment).not.toBe(bAttachment);
    expect(await prisma.messageAttachment.count()).toBe(2);
    expect(await prisma.mediaAsset.count()).toBe(1);
    for (const url of [
      `/v1/chats/${d.first.conversation.id}/media/${bAttachment}`,
      `/v1/chats/${d.second.conversation.id}/media/${aAttachment}`,
      `/v1/chats/${d.first.conversation.id}/messages`,
    ]) {
      const token = url.includes(d.first.conversation.id) ? d.second.token : d.first.token;
      expect((await get(url, token)).statusCode, url).toBe(404);
    }
  });

  it('gives a customer whose access had ended no message at all', async () => {
    const d = await delivered();
    const res = await get(`/v1/chats/${d.expired.conversation.id}/messages`, d.expired.token);
    expect(ChatHistoryResponseSchema.parse(res.json()).items).toHaveLength(0);
    expect(
      ChatUnreadResponseSchema.parse((await get('/v1/chats/unread', d.expired.token)).json())
        .unread_total,
    ).toBe(0);
  });

  it('the received file still opens after the access ends later', async () => {
    const d = await delivered();
    const history = ChatHistoryResponseSchema.parse(
      (await get(`/v1/chats/${d.first.conversation.id}/messages`, d.first.token)).json(),
    );
    await prisma.subscription.updateMany({
      where: { customerId: d.first.userId },
      data: { endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 30 * DAY) },
    });
    const open = await get(
      `/v1/chats/${d.first.conversation.id}/media/${history.items[0]!.attachments[0]!.id}`,
      d.first.token,
    );
    expect(open.statusCode).toBe(200);
  });

  it('the creator sees the message in each conversation, and the upload never entered the gallery', async () => {
    const d = await delivered();
    const res = await get(
      `/v1/creator/conversations/${d.first.conversation.id}/messages`,
      d.creatorLogin.token,
    );
    const mine = CreatorChatHistoryResponseSchema.parse(res.json());
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      sender: 'ME',
      type: 'MEDIA',
      body: TEXT,
      origin: 'MANUAL',
    });
    expect(res.body).not.toMatch(/broadcast/i);

    const gallery = CreatorGalleryResponseSchema.parse(
      (await get('/v1/creator/gallery', d.creatorLogin.token)).json(),
    );
    expect(gallery.items).toHaveLength(0);
  });

  it('a customer cannot reach the gallery file of a broadcast through the gallery routes', async () => {
    const d = await delivered();
    const res = await get(`/v1/creators/by-code/${d.creator.publicCode}/gallery`, d.first.token);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items).toHaveLength(0);
    const direct = await get(
      `/v1/creators/by-code/${d.creator.publicCode}/gallery/${d.assetId}`,
      d.first.token,
    );
    expect(direct.statusCode).toBe(404);
  });
});
