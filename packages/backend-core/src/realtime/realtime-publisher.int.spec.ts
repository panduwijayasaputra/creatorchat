import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatService } from '../chat/chat.service.js';
import { ConversationReadService } from '../chat/conversation-read.service.js';
import { CreatorChatService } from '../creator-chat/creator-chat.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RealtimePublisher, type RealtimeEmitter } from './realtime-publisher.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const outbox = new OutboxService();
const DAY = 86_400_000;

let n = 99_000n;
let codeNo = 0;
beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const user = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Raka', ...data } });

type Sent = { room: string; event: string; payload: object };
function recorder(failOn?: (s: Sent) => boolean): RealtimeEmitter & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    emit(room, event, payload) {
      const item = { room, event, payload };
      if (failOn?.(item)) throw new Error('redis down');
      sent.push(item);
    },
  };
}

async function setup() {
  const owner = await user({ role: 'CREATOR', displayName: 'Salsa' });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `rtpubl${'abcdefgh'[codeNo++]}${'abcdefgh'[codeNo]}` },
  });
  const make = async () => {
    const customer = await user();
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 10 * DAY),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, creatorId: creator.id },
    });
    return { customer, conversation };
  };
  return { owner, creator, a: await make(), b: await make() };
}
type S = Awaited<ReturnType<typeof setup>>;

const customerSend = (s: S, who: 'a' | 'b' = 'a', body = 'halo') =>
  new ChatService(prisma, outbox).send(s[who].customer.id, s[who].conversation.id, {
    clientMessageId: randomUUID(),
    body,
  });
const rooms = (r: { sent: Sent[] }) => r.sent.map((x) => `${x.room}|${x.event}`).sort();
const pending = () => prisma.outboxEvent.count({ where: { realtimePublishedAt: null } });

describe('RealtimePublisher', () => {
  it('emits a customer message to its two participants only, as signals', async () => {
    const s = await setup();
    await customerSend(s);
    const emitter = recorder();
    const res = await new RealtimePublisher(prisma, emitter).publishPending();
    expect(res).toEqual({ published: 1, skipped: 0, failed: 0 });
    expect(rooms(emitter)).toEqual(
      [
        `user:${s.a.customer.id}|conversation.updated`,
        `user:${s.a.customer.id}|message.created`,
        `user:${s.owner.id}|conversation.updated`,
        `user:${s.owner.id}|message.created`,
      ].sort(),
    );
    expect(emitter.sent.some((x) => x.room === `user:${s.b.customer.id}`)).toBe(false);
    const created = emitter.sent.find((x) => x.event === 'message.created')!;
    expect(created.payload).toEqual({ conversation_id: s.a.conversation.id, seq: 1 });
    expect(JSON.stringify(emitter.sent)).not.toContain('halo');
  });

  it('emits a creator reply to that customer and the creator, not to the other customer', async () => {
    const s = await setup();
    await new CreatorChatService(prisma, outbox).send(s.owner.id, s.b.conversation.id, {
      clientMessageId: randomUUID(),
      body: 'balasan',
    });
    const emitter = recorder();
    await new RealtimePublisher(prisma, emitter).publishPending();
    const targets = new Set(emitter.sent.map((x) => x.room));
    expect(targets).toEqual(new Set([`user:${s.b.customer.id}`, `user:${s.owner.id}`]));
  });

  it('sends read.updated to the peer and conversation.updated to the reader', async () => {
    const s = await setup();
    await customerSend(s);
    await new RealtimePublisher(prisma, recorder()).publishPending();
    await new ConversationReadService(prisma, outbox).advance(
      s.owner.id,
      'creator',
      s.a.conversation.id,
      1,
    );
    const emitter = recorder();
    await new RealtimePublisher(prisma, emitter).publishPending();
    expect(emitter.sent).toEqual([
      {
        room: `user:${s.a.customer.id}`,
        event: 'read.updated',
        payload: { conversation_id: s.a.conversation.id, through_seq: 1 },
      },
      {
        room: `user:${s.owner.id}`,
        event: 'conversation.updated',
        payload: { conversation_id: s.a.conversation.id },
      },
    ]);
  });

  it('emits nothing for a rolled-back message and never re-emits a stamped row', async () => {
    const s = await setup();
    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.add(tx, {
          type: 'message.created',
          aggregateType: 'message',
          aggregateId: randomUUID(),
          payload: { message_id: randomUUID(), conversation_id: s.a.conversation.id },
          dedupeKey: `rolled:${randomUUID()}`,
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const emitter = recorder();
    const publisher = new RealtimePublisher(prisma, emitter);
    expect(await publisher.publishPending()).toEqual({ published: 0, skipped: 0, failed: 0 });

    await customerSend(s);
    await publisher.publishPending();
    const first = emitter.sent.length;
    expect(await publisher.publishPending()).toEqual({ published: 0, skipped: 0, failed: 0 });
    expect(emitter.sent.length).toBe(first);
    expect(await pending()).toBe(0);
  });

  it('survives a crash: a failing emit leaves the row, the next tick delivers it', async () => {
    const s = await setup();
    await customerSend(s);
    const broken = recorder(() => true);
    expect(await new RealtimePublisher(prisma, broken).publishPending()).toEqual({
      published: 0,
      skipped: 0,
      failed: 1,
    });
    expect(await pending()).toBe(1);
    const ok = recorder();
    expect(await new RealtimePublisher(prisma, ok).publishPending()).toMatchObject({
      published: 1,
    });
    expect(ok.sent.length).toBe(4);
    expect(await pending()).toBe(0);
  });

  it('one failing row does not block the others', async () => {
    const s = await setup();
    await customerSend(s, 'a');
    await customerSend(s, 'b');
    const emitter = recorder((x) => x.room === `user:${s.a.customer.id}`);
    const res = await new RealtimePublisher(prisma, emitter).publishPending();
    expect(res).toEqual({ published: 1, skipped: 0, failed: 1 });
    expect(emitter.sent.every((x) => x.room !== `user:${s.a.customer.id}`)).toBe(true);
  });

  it('two racing publishers emit each row once', async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) await customerSend(s, i % 2 ? 'a' : 'b', `m${i}`);
    const emitter = recorder();
    await Promise.all([
      new RealtimePublisher(prisma, emitter, { batchSize: 8 }).publishPending(),
      new RealtimePublisher(prisma, emitter, { batchSize: 8 }).publishPending(),
    ]);
    await new RealtimePublisher(prisma, emitter, { batchSize: 50 }).publishPending();
    const created = emitter.sent.filter((x) => x.event === 'message.created');
    // 20 messages × 2 participants, each exactly once
    expect(created).toHaveLength(40);
    expect(await pending()).toBe(0);
  });

  it('stamps without emitting for stale events, unknown conversations and strangers', async () => {
    const s = await setup();
    await customerSend(s);
    const later = () => new Date(Date.now() + 20 * 60_000);
    const stale = recorder();
    expect(await new RealtimePublisher(prisma, stale, { clock: later }).publishPending()).toEqual({
      published: 0,
      skipped: 1,
      failed: 0,
    });
    expect(stale.sent).toEqual([]);

    await outbox.add(prisma, {
      type: 'read.updated',
      aggregateType: 'conversation',
      aggregateId: randomUUID(),
      payload: { conversation_id: randomUUID(), reader_id: s.owner.id, last_read_seq: 1 },
      dedupeKey: `r:${randomUUID()}`,
    });
    await outbox.add(prisma, {
      type: 'read.updated',
      aggregateType: 'conversation',
      aggregateId: s.a.conversation.id,
      payload: {
        conversation_id: s.a.conversation.id,
        reader_id: s.b.customer.id,
        last_read_seq: 1,
      },
      dedupeKey: `r:${randomUUID()}`,
    });
    const emitter = recorder();
    expect(await new RealtimePublisher(prisma, emitter).publishPending()).toEqual({
      published: 0,
      skipped: 2,
      failed: 0,
    });
    expect(emitter.sent).toEqual([]);
    expect(await pending()).toBe(0);
  });

  it('leaves other event types alone', async () => {
    await outbox.add(prisma, {
      type: 'subscription.granted',
      aggregateType: 'subscription',
      aggregateId: randomUUID(),
      payload: { subscription_id: randomUUID() },
      dedupeKey: `g:${randomUUID()}`,
    });
    const emitter = recorder();
    expect(await new RealtimePublisher(prisma, emitter).publishPending()).toEqual({
      published: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await pending()).toBe(1);
  });
});
