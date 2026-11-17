import { buildSignedInitData, loadEnv, LocalDiskStorage } from '@creatorchat/backend-core';
import {
  ChatMediaDetailSchema,
  ChatMediaListResponseSchema,
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
let nextTelegramId = 9800;
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
  `cmx${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bbb`;

async function chat(over: { expired?: boolean } = {}) {
  const creatorLogin = await signIn();
  await prisma.user.update({
    where: { id: creatorLogin.userId },
    data: { role: 'CREATOR', displayName: 'Salsa Maheswari' },
  });
  const creator = await prisma.creator.create({
    data: { userId: creatorLogin.userId, publicCode: code() },
  });
  const customerLogin = await signIn();
  await prisma.subscription.create({
    data: {
      customerId: customerLogin.userId,
      creatorId: creator.id,
      startsAt: new Date(Date.now() - 10 * DAY),
      endsAt: new Date(Date.now() + (over.expired ? -DAY : 10 * DAY)),
    },
  });
  const conversation = await prisma.conversation.create({
    data: { customerId: customerLogin.userId, creatorId: creator.id },
  });
  return { creatorLogin, customerLogin, creator, conversation };
}
type C = Awaited<ReturnType<typeof chat>>;

let seq = 0;
async function sendFile(c: C, body: string | null = null) {
  const assetId = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      creatorId: c.creator.id,
      clientUploadId: randomUUID(),
      purpose: 'CHAT',
      conversationId: c.conversation.id,
      kind: 'PHOTO',
      state: 'READY',
      objectKey: `m/${c.creator.id}/${assetId}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      mime: 'image/jpeg',
      sizeBytes: 10n,
      thumbKey: `m/${c.creator.id}/${assetId}/thumb.webp`,
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: c.conversation.id,
      senderUserId: c.creatorLogin.userId,
      type: 'MEDIA',
      body,
      clientMessageId: randomUUID(),
      seq: ++seq,
    },
  });
  const attachment = await prisma.messageAttachment.create({
    data: { messageId: message.id, assetId },
  });
  const source = path.join(dir, `src-${assetId}`);
  await writeFile(source, Buffer.from(`file-${assetId}`));
  await storage.upload(`m/${c.creator.id}/${assetId}`, source, 'image/jpeg');
  await storage.upload(`m/${c.creator.id}/${assetId}/thumb.webp`, source, 'image/webp');
  return { attachmentId: attachment.id, assetId };
}

const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const listUrl = (conv: string) => `/v1/chats/${conv}/media`;
const itemUrl = (conv: string, id: string) => `${listUrl(conv)}/${id}`;
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};
const withoutLinks = (text: string) =>
  text.replace(/"(thumbnail_url|url)":"[^"]*"/g, '"$1":"[link]"');

describe('customer chat media', () => {
  it('lists and opens the files of my conversation, with links that serve them, no-store and no asset ids', async () => {
    const c = await chat();
    const a = await sendFile(c);
    const b = await sendFile(c, 'Versi pedas.');
    const listRes = await get(listUrl(c.conversation.id), c.customerLogin.token);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.headers['cache-control']).toBe('no-store');
    const list = ChatMediaListResponseSchema.parse(listRes.json());
    expect(list.items.map((i) => i.id)).toEqual([a.attachmentId, b.attachmentId]);
    const thumb = await t.app.inject({
      method: 'GET',
      url: pathOf(list.items[0]?.thumbnail_url as string),
    });
    expect(thumb.body).toBe(`file-${a.assetId}`);

    const res = await get(itemUrl(c.conversation.id, b.attachmentId), c.customerLogin.token);
    expect(res.statusCode).toBe(200);
    const detail = ChatMediaDetailSchema.parse(res.json());
    expect([detail.position, detail.total, detail.previous_id, detail.next_id]).toEqual([
      2,
      2,
      a.attachmentId,
      null,
    ]);
    expect(detail.message.body).toBe('Versi pedas.');
    expect(detail.creator.display_name).toBe('Salsa Maheswari');
    const file = await t.app.inject({ method: 'GET', url: pathOf(detail.original.url) });
    expect(file.body).toBe(`file-${b.assetId}`);
    expect(withoutLinks(listRes.body + res.body)).not.toMatch(/asset_id|object_key|thumb_key/);
    expect(withoutLinks(listRes.body + res.body)).not.toContain(b.assetId);
  });

  it('files received before the access ended, or while the creator is blocked, still open', async () => {
    const c = await chat({ expired: true });
    const f = await sendFile(c);
    expect(
      (await get(itemUrl(c.conversation.id, f.attachmentId), c.customerLogin.token)).statusCode,
    ).toBe(200);
    expect((await get(listUrl(c.conversation.id), c.customerLogin.token)).statusCode).toBe(200);
    const d = await chat();
    const g = await sendFile(d);
    await prisma.creator.update({ where: { id: d.creator.id }, data: { status: 'BLOCKED' } });
    expect(
      (await get(itemUrl(d.conversation.id, g.attachmentId), d.customerLogin.token)).statusCode,
    ).toBe(200);
  });

  it("another customer's conversation or attachment, an asset id and malformed ids are the same 404", async () => {
    const mine = await chat();
    const other = await chat();
    const mineFile = await sendFile(mine);
    const theirs = await sendFile(other);
    for (const url of [
      listUrl(other.conversation.id),
      itemUrl(other.conversation.id, theirs.attachmentId),
      itemUrl(mine.conversation.id, theirs.attachmentId),
      itemUrl(other.conversation.id, mineFile.attachmentId),
      itemUrl(mine.conversation.id, mineFile.assetId),
      itemUrl(mine.conversation.id, randomUUID()),
      itemUrl(mine.conversation.id, 'not-a-uuid'),
      listUrl('not-a-uuid'),
    ]) {
      const res = await get(url, mine.customerLogin.token);
      expect(res.statusCode, url).toBe(404);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('NOT_FOUND');
    }
  });

  it('no token is 401, the creator token is 403, a blocked customer is 401', async () => {
    const c = await chat();
    const f = await sendFile(c);
    const url = itemUrl(c.conversation.id, f.attachmentId);
    expect((await get(url)).statusCode).toBe(401);
    const asCreator = await get(url, c.creatorLogin.token);
    expect(asCreator.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(asCreator.json()).code).toBe('FORBIDDEN_ROLE');
    await prisma.user.update({
      where: { id: c.customerLogin.userId },
      data: { status: 'BLOCKED' },
    });
    expect((await get(url, c.customerLogin.token)).statusCode).toBe(401);
    expect((await get(listUrl(c.conversation.id), c.customerLogin.token)).statusCode).toBe(401);
  });
});
