import {
  buildSignedInitData,
  loadEnv,
  LocalDiskStorage,
  OutboxService,
  SubscriptionAccessService,
  WelcomeDeliveryService,
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
const TEXT = 'Halo, selamat datang! Terima kasih sudah bergabung.';

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let dir: string;
let storage: LocalDiskStorage;
let nextTelegramId = 10_500;

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  dir = await mkdtemp(path.join(tmpdir(), 'cc-api-welcome-delivery-'));
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

/** A creator with a welcome upload configured, one new subscriber granted access, and the welcome delivered. */
async function delivered() {
  const creatorLogin = await signIn();
  await prisma.user.update({
    where: { id: creatorLogin.userId },
    data: { role: 'CREATOR', displayName: 'Salsa Maheswari' },
  });
  const creator = await prisma.creator.create({
    data: { userId: creatorLogin.userId, publicCode: 'wlcmdeli' },
  });
  const assetId = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      creatorId: creator.id,
      clientUploadId: randomUUID(),
      purpose: 'WELCOME',
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
  await prisma.creatorWelcomeMessage.create({
    data: { creatorId: creator.id, enabled: true, body: TEXT, assetId },
  });

  const customer = await signIn();
  const admin = await prisma.adminAccount.create({
    data: { username: 'nadia.admin', passwordHash: 'x' },
  });
  const outbox = new OutboxService();
  const granted = await new SubscriptionAccessService(prisma, outbox).grant(
    customer.userId,
    { creatorId: creator.id, durationDays: 30 },
    { adminId: admin.id, reason: 'Uji coba.', requestId: 'req-1' },
  );
  expect(granted.kind).toBe('ok');
  const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'welcome.requested' } });
  expect(await new WelcomeDeliveryService(prisma, outbox).deliver(event.id)).toEqual({
    kind: 'delivered',
  });
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { customerId: customer.userId },
  });
  return { creatorLogin, creator, customer, conversation, assetId };
}

const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

describe('a delivered welcome message, as the new subscriber sees it', () => {
  it('is the first message of the chat: a normal creator media message, unread, with no label, and its file opens', async () => {
    const d = await delivered();
    const res = await get(`/v1/chats/${d.conversation.id}/messages`, d.customer.token);
    expect(res.statusCode).toBe(200);
    const history = ChatHistoryResponseSchema.parse(res.json());
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ type: 'MEDIA', body: TEXT });
    const bodyWithoutLinks = res.body.replace(
      /"thumbnail_url":"[^"]*"/g,
      '"thumbnail_url":"[link]"',
    );
    expect(bodyWithoutLinks).not.toMatch(/welcome|sambutan|origin|asset_id|object_key|thumb_key/i);
    expect(bodyWithoutLinks).not.toContain(d.assetId);
    expect(
      ChatUnreadResponseSchema.parse((await get('/v1/chats/unread', d.customer.token)).json())
        .unread_total,
    ).toBe(1);

    const attachmentId = history.items[0]!.attachments[0]!.id;
    const open = await get(
      `/v1/chats/${d.conversation.id}/media/${attachmentId}`,
      d.customer.token,
    );
    expect(open.statusCode).toBe(200);
    const detail = ChatMediaDetailSchema.parse(open.json());
    const file = await t.app.inject({ method: 'GET', url: pathOf(detail.original.url) });
    expect(file.body).toBe(`file-${d.assetId}`);
  });

  it("is in the creator's thread as an ordinary reply of theirs, and the upload never entered the gallery", async () => {
    const d = await delivered();
    const res = await get(
      `/v1/creator/conversations/${d.conversation.id}/messages`,
      d.creatorLogin.token,
    );
    const mine = CreatorChatHistoryResponseSchema.parse(res.json());
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ sender: 'ME', body: TEXT, origin: 'MANUAL' });
    const gallery = CreatorGalleryResponseSchema.parse(
      (await get('/v1/creator/gallery', d.creatorLogin.token)).json(),
    );
    expect(gallery.items).toHaveLength(0);
    const viaCustomer = await get(
      `/v1/creators/by-code/${d.creator.publicCode}/gallery`,
      d.customer.token,
    );
    expect((viaCustomer.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it("another customer cannot open the new subscriber's welcome file", async () => {
    const d = await delivered();
    const other = await signIn();
    const history = ChatHistoryResponseSchema.parse(
      (await get(`/v1/chats/${d.conversation.id}/messages`, d.customer.token)).json(),
    );
    const attachmentId = history.items[0]!.attachments[0]!.id;
    expect((await get(`/v1/chats/${d.conversation.id}/messages`, other.token)).statusCode).toBe(
      404,
    );
    expect(
      (await get(`/v1/chats/${d.conversation.id}/media/${attachmentId}`, other.token)).statusCode,
    ).toBe(404);
  });
});
