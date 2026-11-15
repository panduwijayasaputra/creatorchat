import { createServer, type Server } from 'node:http';
import { loadEnv } from '@creatorchat/backend-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, UNREACHABLE, type TestApp } from './helpers.js';

const BOT = '123456:TEST-bot-token-not-real';
const SECRET = 'webhook-secret-'.padEnd(48, 'w');
const MINI = 'https://app.example.test';
const URL_PATH = '/v1/telegram/webhook';
const HEADER = 'x-telegram-bot-api-secret-token';

let fakeBotApi: Server;
let outbound: string[] = [];
let apps: TestApp[] = [];

beforeAll(async () => {
  fakeBotApi = createServer((req, res) => {
    outbound.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: true }));
  });
  await new Promise<void>((resolve) => fakeBotApi.listen(0, '127.0.0.1', resolve));
  const address = fakeBotApi.address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  process.env.TEST_BOT_API_ROOT = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  delete process.env.TEST_BOT_API_ROOT;
  await new Promise<void>((resolve) => fakeBotApi.close(() => resolve()));
});

afterEach(async () => {
  outbound = [];
  await Promise.all(apps.map((t) => t.app.close()));
  apps = [];
});

async function build(overrides: Record<string, string | undefined> = {}): Promise<TestApp> {
  const t = await buildTestApp(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      ...UNREACHABLE,
      TELEGRAM_BOT_TOKEN: BOT,
      TELEGRAM_BOT_USERNAME: 'TestBot',
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      MINIAPP_URL: MINI,
      ...overrides,
    }),
  );
  apps.push(t);
  return t;
}

function startUpdate(text: string, chatType: 'private' | 'group' = 'private') {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 777, type: chatType, first_name: 'Nadia' },
      from: { id: 777, is_bot: false, first_name: 'Nadia' },
      text,
      entities: [{ offset: 0, length: 6, type: 'bot_command' }],
    },
  };
}

const post = (
  t: TestApp,
  payload: unknown,
  headers: Record<string, string> = { [HEADER]: SECRET },
) => t.app.inject({ method: 'POST', url: URL_PATH, headers, payload: payload as object });

describe('POST /v1/telegram/webhook', () => {
  it('answers /start c_<code> with a web_app button to that creator, as the webhook reply', async () => {
    const t = await build();
    const res = await post(t, startUpdate('/start c_k4m5x2qa'));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.method).toBe('sendMessage');
    expect(body.chat_id).toBe(777);
    expect(body.text).toBe('Ketuk tombol di bawah untuk membuka profil creator.');
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({
      text: 'Buka Creator Chat',
      web_app: { url: 'https://app.example.test/creators/k4m5x2qa' },
    });
  });

  it.each([
    '/start',
    '/start c_',
    '/start x_abc',
    '/start c_../../x',
    '/start c_a?b',
    '/start //evil.com',
  ])('opens the plain Mini App URL for %j', async (text) => {
    const t = await build();
    const res = await post(t, startUpdate(text));
    expect(res.statusCode).toBe(200);
    expect(res.json().reply_markup.inline_keyboard[0][0].web_app.url).toBe(
      'https://app.example.test/',
    );
  });

  it('rejects a missing, wrong, differently sized or query-string secret with 401 and no handler run', async () => {
    const t = await build();
    const update = startUpdate('/start c_k4m5x2qa');
    const cases: { headers: Record<string, string>; url?: string }[] = [
      { headers: {} },
      { headers: { [HEADER]: 'wrong' } },
      { headers: { [HEADER]: SECRET + 'x' } },
      { headers: { [HEADER]: SECRET.slice(0, -1) } },
      { headers: {}, url: `${URL_PATH}?secret_token=${SECRET}` },
    ];
    for (const c of cases) {
      const res = await t.app.inject({
        method: 'POST',
        url: c.url ?? URL_PATH,
        headers: c.headers,
        payload: update,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(res.body).not.toContain('sendMessage');
    }
  });

  it('checks the secret before parsing the body', async () => {
    const t = await build();
    const bad = await t.app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json', [HEADER]: 'wrong' },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(401);
    const good = await t.app.inject({
      method: 'POST',
      url: URL_PATH,
      headers: { 'content-type': 'application/json', [HEADER]: SECRET },
      payload: '{not json /start c_secretpayload',
    });
    expect(good.statusCode).toBe(400);
    expect(good.body).not.toContain('secretpayload');
  });

  it('acknowledges unsupported updates with 200 and no reply', async () => {
    const t = await build();
    const updates = [
      startUpdate('/start c_k4m5x2qa', 'group'),
      startUpdate('hello there'),
      {
        update_id: 2,
        callback_query: {
          id: '1',
          from: { id: 1, is_bot: false, first_name: 'N' },
          chat_instance: 'x',
        },
      },
      { update_id: 3, edited_message: startUpdate('/start').message },
      {
        update_id: 4,
        channel_post: { message_id: 1, date: 1, chat: { id: -1, type: 'channel', title: 'c' } },
      },
      { update_id: 5 },
    ];
    for (const update of updates) {
      const res = await post(t, update);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('sendMessage');
    }
  });

  it('answers 503 when the webhook is not configured, while health still responds', async () => {
    for (const missing of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'MINIAPP_URL']) {
      const t = await build({ [missing]: undefined });
      const res = await post(t, startUpdate('/start'));
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      const health = await t.app.inject({ method: 'GET', url: '/v1/health' });
      expect([200, 503]).toContain(health.statusCode);
      expect(health.json()).toHaveProperty('checks');
    }
  });

  it('refuses a secret shorter than 32 characters as unconfigured', async () => {
    const t = await build({ TELEGRAM_WEBHOOK_SECRET: 'short' });
    const res = await post(t, startUpdate('/start'), { [HEADER]: 'short' });
    expect(res.statusCode).toBe(503);
  });

  it('makes no outbound Bot API request (no getMe, no sendMessage)', async () => {
    const t = await build();
    await post(t, startUpdate('/start c_k4m5x2qa'));
    await post(t, startUpdate('hello'));
    expect(outbound).toEqual([]);
  });

  it('never logs the bot token, the secret or the update text, and sets no-store', async () => {
    const t = await build();
    const ok = await post(t, startUpdate('/start c_privatecode'));
    await post(t, startUpdate('/start c_privatecode'), { [HEADER]: 'attacker-guess' });
    expect(ok.headers['cache-control']).toBe('no-store');
    const logs = t.rawLogs();
    expect(logs).not.toContain(BOT);
    expect(logs).not.toContain(SECRET);
    expect(logs).not.toContain('attacker-guess');
    expect(logs).not.toContain('privatecode');
    expect(logs).not.toContain('Nadia');
  });
});
