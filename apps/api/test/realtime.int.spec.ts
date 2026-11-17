import {
  AccountSecurityService,
  ChatService,
  OutboxService,
  RealtimePublisher,
  buildSignedInitData,
  loadEnv,
} from '@creatorchat/backend-core';
import { REALTIME_PATH, TelegramLoginResponseSchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers.js';
import { RealtimeService } from '../src/modules/realtime/realtime.service.js';

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
  `rtgw${'abcdefghjk'[nextCode % 10]}${'abcdefghjk'[Math.floor(nextCode++ / 10) % 10]}bb`;

/** A signed-in account that is promoted to CREATOR with a creator row. */
async function creatorSession() {
  const me = await signIn();
  await prisma.user.update({ where: { id: me.userId }, data: { role: 'CREATOR' } });
  const creator = await prisma.creator.create({ data: { userId: me.userId, publicCode: code() } });
  return { ...me, creator };
}

const open = (auth?: object, query = ''): Socket => {
  const s = connect(`http://127.0.0.1:${port}${query}`, {
    path: REALTIME_PATH,
    auth: auth ?? {},
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
const refused = (s: Socket) =>
  new Promise<{ code?: string; message: string }>((resolve, reject) => {
    s.on('connect_error', (e) => resolve({ message: e.message, ...(e as { data?: object }).data }));
    s.on('connect', () => reject(new Error('connected')));
  });
const disconnected = (s: Socket) => new Promise<string>((resolve) => s.on('disconnect', resolve));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const security = () => new AccountSecurityService(prisma);

describe('handshake', () => {
  it('refuses no token, garbage, a token in the URL and a bad Origin; code only', async () => {
    for (const s of [open(), open({ token: 'garbage' }), open({ token: '' })]) {
      const e = await refused(s);
      expect(e).toEqual({ message: 'refused', code: 'UNAUTHENTICATED' });
    }
    const me = await signIn();
    const inUrl = open({}, `?token=${me.token}`);
    expect((await refused(inUrl)).code).toBe('UNAUTHENTICATED');

    const foreign = connect(`http://127.0.0.1:${port}`, {
      path: REALTIME_PATH,
      auth: { token: me.token },
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { origin: 'https://evil.example' },
    });
    sockets.push(foreign);
    await new Promise<void>((resolve, reject) => {
      foreign.on('connect_error', () => resolve());
      foreign.on('connect', () => reject(new Error('connected')));
    });
  });

  it('accepts a USER and a CREATOR', async () => {
    const user = await signIn();
    const c = await creatorSession();
    await connected(open({ token: user.token }));
    await connected(open({ token: c.token }));
  });

  it('refuses a blocked account and a stale session_version', async () => {
    const me = await signIn();
    await security().blockUser(me.userId);
    expect((await refused(open({ token: me.token }))).code).toBe('UNAUTHENTICATED');
    await security().unblockUser(me.userId);
    expect((await refused(open({ token: me.token }))).code).toBe('UNAUTHENTICATED');
  });
});

describe('open sockets lose access', () => {
  it('a block drops the socket at once and the old token cannot come back', async () => {
    const me = await signIn();
    const s = open({ token: me.token });
    await connected(s);
    const gone = disconnected(s);
    await security().blockUser(me.userId);
    expect(await gone).toBe('io server disconnect');
    expect((await refused(open({ token: me.token }))).code).toBe('UNAUTHENTICATED');
  });

  it('a role change drops the socket at once', async () => {
    const me = await signIn();
    const s = open({ token: me.token });
    await connected(s);
    const gone = disconnected(s);
    await security().changeRole(me.userId, 'CREATOR');
    await gone;
  });

  it('a rolled-back change does not drop anyone', async () => {
    const me = await signIn();
    const s = open({ token: me.token });
    await connected(s);
    await expect(
      prisma.$transaction(async (tx) => {
        await security().blockUserInTransaction(tx, me.userId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await wait(300);
    expect(s.connected).toBe(true);
  });

  it('the recheck ends a revoked session with session.ended first', async () => {
    const me = await signIn();
    const s = open({ token: me.token });
    await connected(s);
    const events: string[] = [];
    s.on('session.ended', () => events.push('session.ended'));
    const gone = disconnected(s);
    await prisma.session.updateMany({
      where: { userId: me.userId },
      data: { revokedAt: new Date() },
    });
    await t.app.get(RealtimeService).recheckAll();
    await gone;
    expect(events).toEqual(['session.ended']);
  });

  it('the recheck leaves a valid session alone', async () => {
    const me = await signIn();
    const s = open({ token: me.token });
    await connected(s);
    await t.app.get(RealtimeService).recheckAll();
    await wait(200);
    expect(s.connected).toBe(true);
  });
});

describe('rooms', () => {
  async function chatSetup() {
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

  it('a message reaches its customer and creator, never the other customer, whatever the client emits', async () => {
    const { c, a, b } = await chatSetup();
    const sa = open({ token: a.token });
    const sb = open({ token: b.token });
    const sc = open({ token: c.token });
    await Promise.all([connected(sa), connected(sb), connected(sc)]);
    await wait(100); // rooms are joined right after the handshake
    // B tries to listen to A's room and to another user's room.
    sb.emit('join', `user:${a.userId}`);
    sb.emit('subscribe', { room: `user:${a.userId}` });

    const got: Record<string, unknown[]> = { a: [], b: [], c: [] };
    for (const [name, s] of [
      ['a', sa],
      ['b', sb],
      ['c', sc],
    ] as const) {
      s.on('message.created', (p) => got[name]!.push(p));
      s.on('conversation.updated', (p) => got[name]!.push(p));
    }
    await new ChatService(prisma, new OutboxService()).send(a.userId, a.conversation.id, {
      clientMessageId: randomUUID(),
      body: 'rahasia',
    });
    const emitterRedis = new Redis(process.env.REDIS_URL as string);
    const emitter = new Emitter(emitterRedis, { key: 'test:socket.io' });
    const res = await new RealtimePublisher(prisma, {
      emit: (room, event, payload) => {
        emitter.to(room).emit(event, payload);
      },
    }).publishPending();
    expect(res.published).toBe(1);
    await wait(400);
    emitterRedis.disconnect();

    const expected = [
      { conversation_id: a.conversation.id, seq: 1 },
      { conversation_id: a.conversation.id },
    ];
    expect(got.a).toEqual(expect.arrayContaining(expected));
    expect(got.c).toEqual(expect.arrayContaining(expected));
    expect(got.b).toEqual([]);
    expect(JSON.stringify(got)).not.toContain('rahasia');
  });
});
