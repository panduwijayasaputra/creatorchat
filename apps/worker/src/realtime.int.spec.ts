import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ChatService, OutboxService } from '@creatorchat/backend-core';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRealtime, type Realtime } from './realtime.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const key = `test:sio:${randomUUID()}`;
const logger = pino({ level: 'silent' });

let http: HttpServer;
let server: Server;
let clients: Socket[] = [];
let realtime: Realtime | undefined;
const redises: Redis[] = [];

beforeEach(async () => {
  await resetDatabase(prisma);
  http = createServer();
  server = new Server(http, { serveClient: false });
  const pub = new Redis(redisUrl);
  const sub = pub.duplicate();
  redises.push(pub, sub);
  server.adapter(createAdapter(pub, sub, { key }));
  // Test stand-in for the API gateway: each socket joins the room named by its handshake.
  server.on('connection', (socket) => {
    void socket.join(String(socket.handshake.auth.room));
  });
  await new Promise<void>((r) => http.listen(0, r));
});
afterEach(async () => {
  clients.forEach((c) => c.disconnect());
  clients = [];
  await realtime?.stop();
  realtime = undefined;
  await server.close();
  redises.splice(0).forEach((r) => r.disconnect());
});
afterAll(() => prisma.$disconnect());

const open = async (room: string): Promise<Socket> => {
  const port = (http.address() as AddressInfo).port;
  const socket = connect(`http://localhost:${port}`, { auth: { room }, transports: ['websocket'] });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.on('connect', resolve));
  // The server joins the room asynchronously after the handshake.
  await new Promise((r) => setTimeout(r, 50));
  return socket;
};

async function conversation() {
  const customer = await prisma.user.create({ data: { telegramId: 98_001n, displayName: 'C' } });
  const owner = await prisma.user.create({
    data: { telegramId: 98_002n, displayName: 'K', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'wrkrtime' },
  });
  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
    },
  });
  const conv = await prisma.conversation.create({
    data: { customerId: customer.id, creatorId: creator.id },
  });
  return { customer, owner, conv };
}

describe('worker realtime loop', () => {
  it('delivers a committed message to the participants over Redis and to nobody else', async () => {
    const { customer, owner, conv } = await conversation();
    const stranger = await open('user:stranger');
    const forCustomer = await open(`user:${customer.id}`);
    const forCreator = await open(`user:${owner.id}`);
    const got: Record<string, unknown[]> = { stranger: [], customer: [], creator: [] };
    for (const [name, s] of [
      ['stranger', stranger],
      ['customer', forCustomer],
      ['creator', forCreator],
    ] as const) {
      s.on('message.created', (p) => got[name]!.push(p));
    }
    const arrived = new Promise<void>((resolve) =>
      forCreator.once('message.created', () => resolve()),
    );

    await new ChatService(prisma, new OutboxService()).send(customer.id, conv.id, {
      clientMessageId: randomUUID(),
      body: 'halo',
    });
    realtime = startRealtime({
      env: { REDIS_URL: redisUrl },
      prisma,
      logger,
      keyPrefix: key,
      intervalMs: 100,
    });
    await arrived;
    await new Promise((r) => setTimeout(r, 200));
    expect(got.creator).toEqual([{ conversation_id: conv.id, seq: 1 }]);
    expect(got.customer).toEqual([{ conversation_id: conv.id, seq: 1 }]);
    expect(got.stranger).toEqual([]);
    expect(await prisma.outboxEvent.count({ where: { realtimePublishedAt: null } })).toBe(0);
  });

  it('keeps ticking after a failing tick and stop() resolves', async () => {
    const broken = createTestPrisma();
    await broken.$disconnect();
    realtime = startRealtime({
      env: { REDIS_URL: redisUrl },
      prisma: broken,
      logger,
      keyPrefix: key,
      intervalMs: 50,
    });
    await new Promise((r) => setTimeout(r, 200));
    await expect(realtime.stop()).resolves.toBeUndefined();
    realtime = undefined;
  });
});
