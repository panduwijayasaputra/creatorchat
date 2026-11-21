import {
  buildSignedInitData,
  loadEnv,
  LocalDiskStorage,
  type MediaUploadService,
} from '@creatorchat/backend-core';
import {
  ChatHistoryResponseSchema,
  CreatorChatHistoryResponseSchema,
  CreatorSendMessageResponseSchema,
  ErrorResponseSchema,
  MediaUploadInitResponseSchema,
  SendMessageResponseSchema,
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
import { MEDIA_UPLOAD } from '../src/modules/media/tokens.js';
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
let nextTelegramId = 9500;
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
  `cmed${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(996, 1)]);

/** A signed-in creator with a customer, an active subscription and a conversation. */
async function chat(over: { expired?: boolean } = {}) {
  const creatorLogin = await signIn();
  await prisma.user.update({ where: { id: creatorLogin.userId }, data: { role: 'CREATOR' } });
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

let galleryNo = 0;
async function galleryAsset(creatorId: string) {
  const id = randomUUID();
  await prisma.mediaAsset.create({
    data: {
      id,
      creatorId,
      clientUploadId: randomUUID(),
      purpose: 'GALLERY',
      kind: 'PHOTO',
      state: 'READY',
      objectKey: `m/${creatorId}/${id}`,
      declaredType: 'image/jpeg',
      declaredBytes: 10n,
      mime: 'image/jpeg',
      sizeBytes: 10n,
      thumbKey: `m/${creatorId}/${id}/thumb.webp`,
    },
  });
  await prisma.galleryItem.create({ data: { creatorId, assetId: id, seq: ++galleryNo } });
  const source = path.join(dir, `src-${id}`);
  await writeFile(source, Buffer.from(`thumb-${id}`));
  await storage.upload(`m/${creatorId}/${id}/thumb.webp`, source, 'image/webp');
  await storage.upload(`m/${creatorId}/${id}`, source, 'image/jpeg');
  return id;
}

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: object) =>
  t.app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const creatorSend = (c: C, payload: object, token = c.creatorLogin.token) =>
  call('POST', `/v1/creator/conversations/${c.conversation.id}/messages`, token, payload);
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

describe('sending a gallery asset', () => {
  it('201 with the attachment; both histories show it, the customer without origin or ids beyond the attachment id', async () => {
    const c = await chat();
    const id = await galleryAsset(c.creator.id);
    const res = await creatorSend(c, {
      client_message_id: randomUUID(),
      attachment: { asset_id: id },
      body: 'lihat ini',
    });
    expect(res.statusCode).toBe(201);
    const sent = CreatorSendMessageResponseSchema.parse(res.json()).message;
    expect(sent).toMatchObject({ type: 'MEDIA', body: 'lihat ini', origin: 'MANUAL' });
    expect(sent.attachments[0]?.id).toBe(id);

    const mine = CreatorChatHistoryResponseSchema.parse(
      (
        await call(
          'GET',
          `/v1/creator/conversations/${c.conversation.id}/messages`,
          c.creatorLogin.token,
        )
      ).json(),
    );
    expect(mine.items[0]?.attachments).toHaveLength(1);

    const theirsRes = await call(
      'GET',
      `/v1/chats/${c.conversation.id}/messages`,
      c.customerLogin.token,
    );
    const theirs = ChatHistoryResponseSchema.parse(theirsRes.json());
    const message = theirs.items[0];
    expect(message).toMatchObject({ type: 'MEDIA', body: 'lihat ini' });
    // The customer gets the id of the attachment row (what the viewer takes), never the asset id.
    const row = await prisma.messageAttachment.findFirstOrThrow({ where: { assetId: id } });
    expect(message?.attachments[0]).toMatchObject({ id: row.id, kind: 'PHOTO' });
    expect(message?.attachments[0]?.id).not.toBe(id);
    expect(theirsRes.body).not.toMatch(
      /"origin"|object_key|thumb_key|asset_id|creator_id|declared/,
    );
    const thumb = await t.app.inject({
      method: 'GET',
      url: pathOf(message?.attachments[0]?.thumbnail_url as string),
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.body).toBe(`thumb-${id}`);
  });

  it('the same client id and asset replays with 200; another asset or a text conflicts with 409', async () => {
    const c = await chat();
    const a = await galleryAsset(c.creator.id);
    const b = await galleryAsset(c.creator.id);
    const client_message_id = randomUUID();
    expect(
      (await creatorSend(c, { client_message_id, attachment: { asset_id: a } })).statusCode,
    ).toBe(201);
    expect(
      (await creatorSend(c, { client_message_id, attachment: { asset_id: a } })).statusCode,
    ).toBe(200);
    for (const payload of [{ attachment: { asset_id: b } }, { body: 'teks' }]) {
      const res = await creatorSend(c, { client_message_id, ...payload });
      expect(res.statusCode).toBe(409);
      expect(ErrorResponseSchema.parse(res.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await prisma.message.count()).toBe(1);
  });
});

describe('sending a chat upload', () => {
  it('init (CHAT) → PUT → complete → 409 MEDIA_NOT_READY → worker step → send 201 → reuse is 404', async () => {
    const c = await chat();
    const init = await call('POST', '/v1/creator/media/uploads', c.creatorLogin.token, {
      client_upload_id: randomUUID(),
      kind: 'PHOTO',
      content_type: 'image/jpeg',
      size_bytes: 1000,
      purpose: 'CHAT',
      conversation_id: c.conversation.id,
    });
    expect(init.statusCode).toBe(201);
    const body = MediaUploadInitResponseSchema.parse(init.json());
    if (!body.upload) throw new Error('no upload');
    await t.app.inject({
      method: 'PUT',
      url: pathOf(body.upload.url),
      headers: { 'content-type': 'image/jpeg' },
      payload: JPEG,
    });
    await call('POST', `/v1/creator/media/uploads/${body.asset.id}/complete`, c.creatorLogin.token);

    const early = await creatorSend(c, {
      client_message_id: randomUUID(),
      attachment: { asset_id: body.asset.id },
    });
    expect(early.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(early.json()).code).toBe('MEDIA_NOT_READY');

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
    const source = path.join(dir, 'chat-thumb');
    await writeFile(source, Buffer.from('chat-thumb'));
    await storage.upload(`${row.objectKey}/thumb.webp`, source, 'image/webp');

    const ok = await creatorSend(c, {
      client_message_id: randomUUID(),
      attachment: { asset_id: row.id },
    });
    expect(ok.statusCode).toBe(201);
    expect(await prisma.galleryItem.count()).toBe(0);
    const again = await creatorSend(c, {
      client_message_id: randomUUID(),
      attachment: { asset_id: row.id },
    });
    expect(again.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(again.json()).code).toBe('MEDIA_NOT_FOUND');
  });

  it("refuses a CHAT init for another creator's conversation (404), an ended chat (403) and a missing conversation id (400)", async () => {
    const mine = await chat();
    const other = await chat();
    const ended = await chat({ expired: true });
    const init = (c: C, extra: object) =>
      call('POST', '/v1/creator/media/uploads', c.creatorLogin.token, {
        client_upload_id: randomUUID(),
        kind: 'PHOTO',
        content_type: 'image/jpeg',
        size_bytes: 1000,
        purpose: 'CHAT',
        ...extra,
      });
    expect((await init(mine, { conversation_id: other.conversation.id })).statusCode).toBe(404);
    const expired = await init(ended, { conversation_id: ended.conversation.id });
    expect(expired.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(expired.json()).code).toBe('CHAT_ACCESS_EXPIRED');
    expect((await init(mine, {})).statusCode).toBe(400);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});

describe('who may send what', () => {
  it("another creator's asset is 404 MEDIA_NOT_FOUND; neither text nor file is 400; a USER token is 403", async () => {
    const c = await chat();
    const other = await chat();
    const theirs = await galleryAsset(other.creator.id);
    const res = await creatorSend(c, {
      client_message_id: randomUUID(),
      attachment: { asset_id: theirs },
    });
    expect(res.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(res.json()).code).toBe('MEDIA_NOT_FOUND');
    expect((await creatorSend(c, { client_message_id: randomUUID() })).statusCode).toBe(400);
    const asUser = await creatorSend(
      c,
      { client_message_id: randomUUID(), body: 'x' },
      c.customerLogin.token,
    );
    expect(asUser.statusCode).toBe(403);
    expect(await prisma.message.count()).toBe(0);
  });

  it('a customer cannot send an attachment (strict body → 400) but still sends text', async () => {
    const c = await chat();
    const id = await galleryAsset(c.creator.id);
    const bad = await call(
      'POST',
      `/v1/chats/${c.conversation.id}/messages`,
      c.customerLogin.token,
      {
        client_message_id: randomUUID(),
        body: 'hai',
        attachment: { asset_id: id },
      },
    );
    expect(bad.statusCode).toBe(400);
    const ok = await call(
      'POST',
      `/v1/chats/${c.conversation.id}/messages`,
      c.customerLogin.token,
      {
        client_message_id: randomUUID(),
        body: 'hai',
      },
    );
    expect(ok.statusCode).toBe(201);
    expect(SendMessageResponseSchema.parse(ok.json()).message.attachments).toEqual([]);
  });

  it('an ended chat refuses the send with 403 and stores nothing; what was received stays readable', async () => {
    const c = await chat();
    const id = await galleryAsset(c.creator.id);
    expect(
      (await creatorSend(c, { client_message_id: randomUUID(), attachment: { asset_id: id } }))
        .statusCode,
    ).toBe(201);
    await prisma.subscription.updateMany({ data: { endsAt: new Date(Date.now() - 1000) } });
    const refused = await creatorSend(c, {
      client_message_id: randomUUID(),
      attachment: { asset_id: id },
    });
    expect(refused.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(refused.json()).code).toBe('CHAT_ACCESS_EXPIRED');
    expect(await prisma.message.count()).toBe(1);
    const history = ChatHistoryResponseSchema.parse(
      (await call('GET', `/v1/chats/${c.conversation.id}/messages`, c.customerLogin.token)).json(),
    );
    const row = await prisma.messageAttachment.findFirstOrThrow({ where: { assetId: id } });
    expect(history.items[0]?.attachments[0]?.id).toBe(row.id);
  });
});
