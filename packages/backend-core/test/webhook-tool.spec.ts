import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWebhookCommand, WebhookToolError } from '../scripts/webhook-tool.js';

const TOKEN = '123456:local-dev-token-not-real';
const SECRET = 'webhook-secret-'.padEnd(48, 'w');
const env = {
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  API_PUBLIC_URL: 'https://api.example.test',
  MINIAPP_URL: 'https://app.example.test',
};

let server: Server;
let apiRoot: string;
let calls: { path: string; body: Record<string, unknown> }[] = [];
let respond: { status: number; body: unknown } = { status: 200, body: { ok: true, result: true } };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += String(c)));
    req.on('end', () => {
      calls.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : {} });
      res.writeHead(respond.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(respond.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  apiRoot = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  calls = [];
  respond = { status: 200, body: { ok: true, result: true } };
});

async function run(argv: string[], e: Record<string, string | undefined> = env) {
  const out: string[] = [];
  await runWebhookCommand(argv, e, { apiRoot, log: (l) => out.push(l) });
  return out.join('\n');
}

describe('telegram:webhook tool', () => {
  it('is a dry run without --yes: prints the plan and makes no request', async () => {
    const out = await run(['set']);
    expect(out).toContain('https://api.example.test/v1/telegram/webhook');
    expect(out).toContain('Dry run');
    expect(calls).toEqual([]);
    await run(['delete']);
    expect(calls).toEqual([]);
  });

  it('with --yes sends setWebhook (secret, message updates only) and setChatMenuButton', async () => {
    await run(['set', '--yes']);
    expect(calls.map((c) => c.path)).toEqual([
      `/bot${TOKEN}/setWebhook`,
      `/bot${TOKEN}/setChatMenuButton`,
    ]);
    expect(calls[0]?.body).toEqual({
      url: 'https://api.example.test/v1/telegram/webhook',
      secret_token: SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
    expect(calls[1]?.body).toMatchObject({
      menu_button: { type: 'web_app', web_app: { url: 'https://app.example.test/' } },
    });
  });

  it('drops pending updates only when asked, and deletes with --yes', async () => {
    await run(['set', '--yes', '--drop-pending']);
    expect(calls[0]?.body.drop_pending_updates).toBe(true);
    calls = [];
    await run(['delete', '--yes']);
    expect(calls.map((c) => c.path)).toEqual([`/bot${TOKEN}/deleteWebhook`]);
  });

  it('info is read-only and prints the registered URL without the secret', async () => {
    respond = {
      status: 200,
      body: {
        ok: true,
        result: {
          url: 'https://api.example.test/v1/telegram/webhook?x=1',
          pending_update_count: 2,
        },
      },
    };
    const out = await run(['info']);
    expect(out).toContain('Webhook URL: https://api.example.test/v1/telegram/webhook');
    expect(out).toContain('Pending updates: 2');
    expect(out).not.toContain('x=1');
  });

  it('refuses production, missing/placeholder token, short or reused secret and non-https URLs', async () => {
    const bad: Record<string, string | undefined>[] = [
      { ...env, NODE_ENV: 'production' },
      { ...env, TELEGRAM_BOT_TOKEN: undefined },
      { ...env, TELEGRAM_BOT_TOKEN: '<set-locally>' },
      { ...env, TELEGRAM_WEBHOOK_SECRET: 'short' },
      { ...env, TELEGRAM_WEBHOOK_SECRET: undefined },
      {
        ...env,
        TELEGRAM_WEBHOOK_SECRET: TOKEN.padEnd(40, 'x'),
        TELEGRAM_BOT_TOKEN: TOKEN.padEnd(40, 'x'),
      },
      { ...env, API_PUBLIC_URL: 'http://api.example.test' },
      { ...env, API_PUBLIC_URL: 'https://<tunnel-or-domain>' },
      { ...env, MINIAPP_URL: 'http://localhost:5173' },
      { ...env, MINIAPP_URL: undefined },
    ];
    for (const e of bad) {
      await expect(run(['set', '--yes'], e)).rejects.toBeInstanceOf(WebhookToolError);
    }
    expect(calls).toEqual([]);
  });

  it('rejects unknown commands and extra arguments', async () => {
    await expect(run([])).rejects.toBeInstanceOf(WebhookToolError);
    await expect(run(['explode'])).rejects.toBeInstanceOf(WebhookToolError);
    await expect(run(['set', 'again'])).rejects.toBeInstanceOf(WebhookToolError);
  });

  it('reports Telegram errors without the token or secret', async () => {
    respond = { status: 401, body: { ok: false, description: 'Unauthorized' } };
    const error = await run(['set', '--yes']).catch((e: Error) => e);
    expect(error).toBeInstanceOf(WebhookToolError);
    const message = (error as Error).message;
    expect(message).toContain('Unauthorized');
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(SECRET);
  });

  it('never prints the bot token or the secret', async () => {
    const outputs = [
      await run(['set']),
      await run(['set', '--yes']),
      await run(['delete', '--yes']),
    ];
    for (const out of outputs) {
      expect(out).not.toContain(TOKEN);
      expect(out).not.toContain(SECRET);
    }
  });

  it('hides the token when the network fails', async () => {
    const error = await runWebhookCommand(['info'], env, {
      apiRoot: 'http://127.0.0.1:1',
      log: () => {},
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(WebhookToolError);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
