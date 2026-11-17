import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrammySender } from './grammy-sender.js';

const TOKEN = '123456:SECRET-bot-token';
const message = {
  text: 'Halo <b>x</b>',
  buttonText: 'Buka Aplikasi',
  url: 'https://app.example.test/',
};

let server: Server;
let root: string;
let requests: { path: string; body: Record<string, unknown> }[];
let reply: (res: ServerResponse) => void;

const json = (status: number, body: unknown) => (res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

beforeEach(async () => {
  requests = [];
  reply = json(200, {
    ok: true,
    result: { message_id: 77, date: 1, chat: { id: 1, type: 'private' } },
  });
  server = createServer(async (req, res) => {
    requests.push({ path: req.url ?? '', body: await readBody(req) });
    reply(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const sender = () => createGrammySender({ token: TOKEN, apiRoot: root });

describe('createGrammySender', () => {
  it('sends plain text with one web_app button on the app origin', async () => {
    expect(await sender().sendMessage(582917403n, message)).toEqual({ kind: 'ok', messageId: 77 });
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req?.path).toBe(`/bot${TOKEN}/sendMessage`);
    expect(req?.body).toMatchObject({
      chat_id: 582917403,
      text: 'Halo <b>x</b>',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Buka Aplikasi', web_app: { url: 'https://app.example.test/' } }],
        ],
      },
    });
    expect(req?.body).not.toHaveProperty('parse_mode');
  });

  it('maps 429 with retry_after', async () => {
    reply = json(429, {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests: retry after 9',
      parameters: { retry_after: 9 },
    });
    expect(await sender().sendMessage(1n, message)).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 9,
    });
  });

  it('maps 403 to blocked, other 4xx to permanent, 5xx to transient', async () => {
    reply = json(403, {
      ok: false,
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    expect(await sender().sendMessage(1n, message)).toEqual({ kind: 'blocked' });
    reply = json(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    expect(await sender().sendMessage(1n, message)).toEqual({
      kind: 'permanent',
      code: 'http_400',
    });
    reply = json(500, { ok: false, error_code: 500, description: 'Internal Server Error' });
    expect(await sender().sendMessage(1n, message)).toEqual({
      kind: 'transient',
      code: 'http_500',
    });
  });

  it('treats a rejected token (401/404) as retryable configuration trouble, not a user fact', async () => {
    reply = json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    expect(await sender().sendMessage(1n, message)).toEqual({
      kind: 'transient',
      code: 'http_401',
    });
  });

  it('treats an unreachable server as ambiguous', async () => {
    const dead = createGrammySender({ token: TOKEN, apiRoot: 'http://127.0.0.1:1' });
    expect(await dead.sendMessage(1n, message)).toEqual({ kind: 'ambiguous', code: 'network' });
  });

  it('never puts the token or an error message into an outcome', async () => {
    reply = json(400, { ok: false, error_code: 400, description: `bad ${TOKEN}` });
    const outcome = await sender().sendMessage(1n, message);
    expect(JSON.stringify(outcome)).not.toContain('SECRET');
    const dead = await createGrammySender({
      token: TOKEN,
      apiRoot: 'http://127.0.0.1:1',
    }).sendMessage(1n, message);
    expect(JSON.stringify(dead)).not.toContain('SECRET');
  });

  it('refuses a chat id that does not fit a JSON number', async () => {
    expect(await sender().sendMessage(2n ** 60n, message)).toEqual({
      kind: 'permanent',
      code: 'bad_chat_id',
    });
    expect(requests).toHaveLength(0);
  });
});
