import { RealtimePublisher, buildSignedInitData, loadEnv } from '@creatorchat/backend-core';
import {
  REALTIME_PATH,
  TelegramLoginResponseSchema,
  chatMessagesPath,
  chatReadPath,
  creatorChatMessagesPath,
  creatorReadPath,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';

loadRootEnv();

const ORIGIN = 'http://localhost:5173';
const BOT = '123456:TEST-bot-token-not-real';
const USER_SECRET = 'user-session-secret-'.padEnd(48, 'u');
const ACCESS = 'access-secret-'.padEnd(48, 'a');
const REFRESH = 'refresh-secret-'.padEnd(48, 'r');

let t: TestApp;
let prisma: PrismaClient;
let redis: Redis;
let nextTelegramId = 7000;
let nextCode = 0;
let port = 0;
let sockets: Socket[] = [];

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
      USER_SESSION_SECRET: USER_SECRET,
      ADMIN_ACCESS_TOKEN_SECRET: ACCESS,
      ADMIN_REFRESH_TOKEN_SECRET: REFRESH,
      COOKIE_SECURE: 'false',
    }),
  );
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  port = (t.app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await t.app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  sockets.forEach((s) => s.disconnect());
  sockets = [];
  await resetDatabase(prisma);
  const keys = await redis.keys('test:user:login:*');
  if (keys.length > 0) await redis.del(...keys);
});

async function signIn(): Promise<{ token: string; userId: string }> {
  const id = nextTelegramId++;
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/telegram',
    headers: { origin: ORIGIN },
    payload: {
      init_data: buildSignedInitData({
        botToken: BOT,
        user: { id, first_name: 'Maya' },
        authDate: new Date(),
      }),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = TelegramLoginResponseSchema.parse(res.json());
  return { token: body.access_token, userId: body.user.id };
}

const DAY = 86_400_000;
const code = () =>
  `rtee${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

/** A signed-in account that is promoted to CREATOR with a creator row. */
async function creatorSession() {
  const me = await signIn();
  await prisma.user.update({ where: { id: me.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({ data: { userId: me.userId, publicCode: code() } });
  return { ...me, creator };
}

const open = (token: string): Socket => {
  const s = connect(`http://127.0.0.1:${port}`, {
    path: REALTIME_PATH,
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { origin: ORIGIN },
  });
  sockets.push(s);
  return s;
};
const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.on('connect', () => resolve());
    s.on('connect_error', (e) => reject(e));
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const authz = (token: string) => ({ authorization: `Bearer ${token}` });
const http = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
  t.app.inject({ method, url, headers: authz(token), ...(payload ? { payload } : {}) });

/** What the worker's loop does each second, with a Redis emitter on the API's test prefix. */
async function publishTick() {
  const emitterRedis = new Redis(process.env.REDIS_URL as string);
  const emitter = new Emitter(emitterRedis, { key: 'test:socket.io' });
  const res = await new RealtimePublisher(prisma, {
    emit: (room, event, payload) => {
      emitter.to(room).emit(event, payload);
    },
  }).publishPending();
  await wait(150);
  emitterRedis.disconnect();
  return res;
}

function collect(s: Socket) {
  const events: { name: string; payload: unknown }[] = [];
  for (const name of ['message.created', 'read.updated', 'conversation.updated']) {
    s.on(name, (payload) => events.push({ name, payload }));
  }
  return events;
}

async function world() {
  const c = await creatorSession();
  const make = async () => {
    const me = await signIn();
    await prisma.subscription.create({
      data: {
        customerId: me.userId,
        creatorId: c.creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { customerId: me.userId, creatorId: c.creator.id },
    });
    return { ...me, conversation };
  };
  return { c, a: await make(), b: await make() };
}

const customerSend = (token: string, conversationId: string, body: string) =>
  http('POST', chatMessagesPath(conversationId), token, {
    client_message_id: randomUUID(),
    body,
  });

describe('two-user flow over real HTTP, outbox, publisher and sockets', () => {
  it('delivers message and read signals to the right people, and HTTP shows the content', async () => {
    const { c, a, b } = await world();
    const sa = open(a.token);
    const sb = open(b.token);
    const sc = open(c.token);
    await Promise.all([connected(sa), connected(sb), connected(sc)]);
    await wait(100);
    const ea = collect(sa);
    const eb = collect(sb);
    const ec = collect(sc);

    const sent = await customerSend(a.token, a.conversation.id, 'Halo kak, ada resep?');
    expect(sent.statusCode).toBe(201);
    expect((await publishTick()).published).toBe(1);

    const names = (e: typeof ea) => e.map((x) => x.name).sort();
    expect(names(ea)).toEqual(['conversation.updated', 'message.created']);
    expect(names(ec)).toEqual(['conversation.updated', 'message.created']);
    expect(eb).toEqual([]);
    expect(ea.find((x) => x.name === 'message.created')?.payload).toEqual({
      conversation_id: a.conversation.id,
      seq: 1,
    });
    // the signal holds no content; the creator reads it over HTTP
    expect(JSON.stringify([...ea, ...ec])).not.toContain('resep');
    const history = await http('GET', creatorChatMessagesPath(a.conversation.id), c.token);
    expect(JSON.stringify(history.json())).toContain('Halo kak, ada resep?');

    // the creator replies and reads: the customer gets the message and, later, the read tick
    ea.length = 0;
    ec.length = 0;
    await http('POST', creatorChatMessagesPath(a.conversation.id), c.token, {
      client_message_id: randomUUID(),
      body: 'Ada, aku kirim ya.',
    });
    await publishTick();
    expect(names(ea)).toEqual(['conversation.updated', 'message.created']);
    ea.length = 0;
    ec.length = 0;
    const read = await http('POST', creatorReadPath(a.conversation.id), c.token, {
      through_seq: 2,
    });
    expect(read.statusCode).toBe(200);
    await publishTick();
    expect(ea).toEqual([
      { name: 'read.updated', payload: { conversation_id: a.conversation.id, through_seq: 2 } },
    ]);
    expect(ec.map((x) => x.name)).toEqual(['conversation.updated']);

    // and the customer's read reaches the creator
    ea.length = 0;
    ec.length = 0;
    await http('POST', chatReadPath(a.conversation.id), a.token, { through_seq: 2 });
    await publishTick();
    expect(ec).toEqual([
      { name: 'read.updated', payload: { conversation_id: a.conversation.id, through_seq: 2 } },
    ]);
    expect(eb).toEqual([]);
  });

  it('reconnect catch-up: nothing is lost while disconnected, and a retry makes no duplicate', async () => {
    const { c, a } = await world();
    const sa = open(a.token);
    const sc = open(c.token);
    await Promise.all([connected(sa), connected(sc)]);
    await wait(100);
    const first = randomUUID();
    const post = (body: string, id = randomUUID()) =>
      http('POST', chatMessagesPath(a.conversation.id), a.token, { client_message_id: id, body });
    await post('satu', first);
    await publishTick();
    const lastSeq = 1;

    // the creator's connection drops; two messages arrive meanwhile (their signals are missed)
    sc.disconnect();
    await wait(100);
    await post('dua');
    await post('tiga');
    await publishTick();

    // reconnect: an HTTP fetch returns everything after the last known seq, each once
    const sc2 = open(c.token);
    await connected(sc2);
    const page = (
      await http('GET', creatorChatMessagesPath(a.conversation.id) + '?limit=30', c.token)
    ).json() as { items: { seq: number; body: string }[] };
    expect(
      page.items
        .filter((m) => m.seq > lastSeq)
        .map((m) => m.body)
        .sort(),
    ).toEqual(['dua', 'tiga']);

    // the customer retried 'satu' over the flaky link: same client id, still one row
    expect((await post('satu', first)).statusCode).toBe(200);
    expect(await prisma.message.count({ where: { conversationId: a.conversation.id } })).toBe(3);
  });
});
