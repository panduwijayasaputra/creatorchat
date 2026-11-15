import { buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  CreatorLinkResponseSchema,
  TelegramLoginResponseSchema,
  landingPathForRole,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

/**
 * The whole deep-link journey over a real listening socket: Telegram posts `/start c_<code>` to the
 * webhook, the reply button carries the Mini App path, the Mini App logs in (signed initData) and
 * resolves that same code on the server. The bot itself is not contacted (webhook reply).
 */
const ORIGIN = 'http://localhost:5173';
const MINI = 'https://app.example.test';
const BOT = '123456:E2E-bot-token-not-real';
const SECRET = 'e2e-webhook-secret-'.padEnd(48, 'w');

let t: TestApp;
let base: string;
let prisma: PrismaClient;
let redis: Redis;

const startUpdate = (text: string) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 31337, type: 'private', first_name: 'Maya' },
    from: { id: 31337, is_bot: false, first_name: 'Maya' },
    text,
    entities: [{ offset: 0, length: 6, type: 'bot_command' }],
  },
});

const webhook = (body: unknown, secret: string | null = SECRET) =>
  fetch(`${base}/v1/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: JSON.stringify(body),
  });

async function login(telegramId: number): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/v1/auth/telegram`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id: telegramId, first_name: 'Maya' },
        authDate: new Date(),
      }),
    }),
  });
  expect(res.status).toBe(200);
  const body = TelegramLoginResponseSchema.parse(await res.json());
  return { token: body.access_token, userId: body.user.id };
}

const byCode = (code: string, token: string) =>
  fetch(`${base}/v1/creators/by-code/${code}`, {
    headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
  });

beforeAll(async () => {
  prisma = createTestPrisma();
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
  await resetDatabase(prisma);
  const keys = await redis.keys('test:user:login:*');
  if (keys.length > 0) await redis.del(...keys);
  const creator = await prisma.user.create({
    data: { telegramId: 900n, displayName: 'Salsa', role: 'CREATOR' },
  });
  await prisma.creator.create({ data: { userId: creator.id, publicCode: 'salsa234' } });
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      REDIS_URL: process.env.REDIS_URL,
      ALLOWED_ORIGINS: ORIGIN,
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_BOT_USERNAME: 'E2EBot',
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      MINIAPP_URL: MINI,
      USER_SESSION_SECRET: 'e2e-user-secret-'.padEnd(48, 'u'),
    }),
  );
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

describe('creator deep link, end to end', () => {
  it('webhook reply carries the path, and that code resolves after login', async () => {
    const reply = await webhook(startUpdate('/start c_salsa234'));
    expect(reply.status).toBe(200);
    const body = (await reply.json()) as {
      reply_markup: { inline_keyboard: { web_app: { url: string } }[][] };
    };
    const url = new URL(body.reply_markup.inline_keyboard[0]?.[0]?.web_app.url ?? '');
    expect(url.origin).toBe(MINI);
    expect(url.pathname).toBe('/creators/salsa234');

    const { token } = await login(31337);
    const code = url.pathname.split('/').pop() ?? '';
    const resolved = await byCode(code, token);
    expect(resolved.status).toBe(200);
    expect(CreatorLinkResponseSchema.parse(await resolved.json())).toEqual({
      public_code: 'salsa234',
      display_name: 'Salsa',
      avatar_url: null,
    });
    // Resolving a link grants nothing: still no subscription-like data, same role.
    expect(landingPathForRole('USER')).toBe('/chats');
  });

  it('rejects the webhook without the secret and answers unknown codes with the same 404', async () => {
    expect((await webhook(startUpdate('/start c_salsa234'), null)).status).toBe(401);
    expect((await webhook(startUpdate('/start c_salsa234'), 'nope')).status).toBe(401);

    const { token } = await login(31338);
    const unknown = await byCode('zzzzzzzz', token);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('CREATOR_NOT_FOUND');
  });

  it('a CREATOR session gets 403 and keeps the CREATOR role', async () => {
    const { token, userId } = await login(31339);
    await prisma.user.update({ where: { id: userId }, data: { role: 'CREATOR' } });
    const res = await byCode('salsa234', token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN_ROLE');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('CREATOR');
  });
});
