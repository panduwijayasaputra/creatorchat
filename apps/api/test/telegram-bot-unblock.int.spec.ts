import { loadEnv } from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, UNREACHABLE, type TestApp } from './helpers.js';

loadRootEnv();

const BOT = '123456:TEST-bot-token-not-real';
const SECRET = 'webhook-secret-'.padEnd(48, 'w');
const HEADER = 'x-telegram-bot-api-secret-token';
const URL_PATH = '/v1/telegram/webhook';
const BLOCKED_AT = new Date('2026-11-10T10:00:00.000Z');

let prisma: PrismaClient;
let t: TestApp | undefined;

beforeAll(() => {
  prisma = createTestPrisma();
});
beforeEach(async () => {
  await resetDatabase(prisma);
});
afterEach(async () => {
  await t?.app.close();
  t = undefined;
});
afterAll(() => prisma.$disconnect());

async function build(databaseUrl = process.env.DATABASE_URL_TEST as string): Promise<TestApp> {
  t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      ...UNREACHABLE,
      DATABASE_URL: databaseUrl,
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_BOT_USERNAME: 'TestBot',
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      MINIAPP_URL: 'https://app.example.test',
    }),
  );
  return t;
}

const update = (text: string, opts: { chat?: 'private' | 'group'; from?: number | null } = {}) => ({
  update_id: 1,
  message: {
    message_id: 10,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 777, type: opts.chat ?? 'private', first_name: 'Maya' },
    ...(opts.from === null
      ? {}
      : { from: { id: opts.from ?? 777, is_bot: false, first_name: 'Maya' } }),
    text,
    entities: [{ offset: 0, length: text.split(' ')[0]?.length ?? 6, type: 'bot_command' }],
  },
});

const post = (app: TestApp, payload: unknown, secret = SECRET) =>
  app.app.inject({
    method: 'POST',
    url: URL_PATH,
    headers: { [HEADER]: secret },
    payload: payload as object,
  });

const makeUser = (telegramId: bigint, blocked: boolean) =>
  prisma.user.create({
    data: { telegramId, displayName: 'U', botBlockedAt: blocked ? BLOCKED_AT : null },
  });
const flag = async (telegramId: bigint) =>
  (await prisma.user.findUniqueOrThrow({ where: { telegramId } })).botBlockedAt;

describe('/start clears the bot-blocked flag', () => {
  it('clears the sender’s flag and still sends the normal reply', async () => {
    await makeUser(777n, true);
    await makeUser(888n, true);
    const app = await build();
    const res = await post(app, update('/start'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ method: 'sendMessage', chat_id: 777 });
    expect(await flag(777n)).toBeNull();
    expect(await flag(888n)).not.toBeNull(); // other users' flags are untouched
  });

  it('works with a deep-link payload', async () => {
    await makeUser(777n, true);
    const app = await build();
    await post(app, update('/start c_k4m5x2qa'));
    expect(await flag(777n)).toBeNull();
  });

  it('clears nothing for a group chat, another command or an update without a sender', async () => {
    await makeUser(777n, true);
    const app = await build();
    await post(app, update('/start', { chat: 'group' }));
    await post(app, update('/help'));
    await post(app, update('/start', { from: null }));
    expect(await flag(777n)).not.toBeNull();
  });

  it('creates no user for an unknown sender and leaves the rest of the row alone', async () => {
    const user = await makeUser(777n, true);
    const app = await build();
    await post(app, update('/start', { from: 999 }));
    expect(await prisma.user.count()).toBe(1);
    await post(app, update('/start'));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ role: 'USER', status: 'ACTIVE', sessionVersion: 1 });
  });

  it('keeps the webhook secret rule: a wrong secret clears nothing', async () => {
    await makeUser(777n, true);
    const app = await build();
    const res = await post(app, update('/start'), 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(await flag(777n)).not.toBeNull();
  });

  it('still answers with the reply when the database is unavailable', async () => {
    const app = await build('postgresql://nobody:nope@127.0.0.1:1/none');
    const res = await post(app, update('/start'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ method: 'sendMessage', chat_id: 777 });
    expect(app.rawLogs()).not.toContain('nope');
  });
});
