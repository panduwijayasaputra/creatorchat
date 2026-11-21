import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BotMessage } from './creator-result-message.js';
import { TelegramDeliveryRunner } from './delivery-runner.js';
import {
  SkipDelivery,
  type NotificationEvent,
  type NotificationHandler,
  type Resolution,
} from './handler.js';
import { NotificationRouter } from './notification-router.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const T0 = new Date('2026-11-21T10:00:00.000Z');

class FakeSender implements TelegramSender {
  calls: { chatId: bigint; message: BotMessage }[] = [];
  script: (SendOutcome | Error)[] = [];
  async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
    this.calls.push({ chatId, message });
    const next = this.script.shift() ?? { kind: 'ok', messageId: 500 + this.calls.length };
    if (next instanceof Error) throw next;
    return next;
  }
}

/** A handler whose answer the test controls. */
function stub(answer: (event: NotificationEvent) => Resolution): NotificationHandler & {
  seen: { existing: boolean }[];
} {
  const seen: { existing: boolean }[] = [];
  return {
    types: ['test.event'],
    seen,
    async resolve(event, ctx) {
      seen.push({ existing: ctx.existingDelivery !== null });
      return answer(event);
    },
  };
}

async function setup(opts: { blocked?: boolean; botBlocked?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      telegramId: 582917403n,
      displayName: 'Maya',
      status: opts.blocked ? 'BLOCKED' : 'ACTIVE',
      botBlockedAt: opts.botBlocked ? T0 : null,
    },
  });
  const event = await prisma.outboxEvent.create({
    data: {
      type: 'test.event',
      aggregateType: 'test',
      aggregateId: user.id,
      payload: {},
      dedupeKey: `test:${user.id}`,
      status: 'ENQUEUED',
      enqueuedAt: T0,
    },
  });
  const recipient = {
    id: user.id,
    telegramId: user.telegramId,
    status: user.status as 'ACTIVE' | 'BLOCKED',
    botBlockedAt: user.botBlockedAt,
  };
  return { user, event, recipient };
}

const MESSAGE: BotMessage = { text: 'Halo', buttonText: 'Buka', url: 'https://app.example.test/' };
const sendAnswer =
  (recipient: Parameters<typeof Object>[0], extra: Record<string, unknown> = {}) =>
  (event: NotificationEvent): Resolution =>
    ({
      kind: 'send',
      recipient,
      deliveryKind: 'test_kind',
      dedupeKey: `test:${event.id}:telegram`,
      message: MESSAGE,
      ...extra,
    }) as Resolution;

function make(sender: TelegramSender, handler: NotificationHandler) {
  const runner = new TelegramDeliveryRunner(prisma, sender, {
    miniAppUrl: 'https://app.example.test',
    clock: () => T0,
  });
  return new NotificationRouter(prisma, runner, [handler]);
}
const eventRow = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('TelegramDeliveryRunner', () => {
  it('sends once and settles the delivery and the event', async () => {
    const { user, event, recipient } = await setup();
    const sender = new FakeSender();
    const router = make(sender, stub(sendAnswer(recipient)));
    expect(await router.process(event.id)).toBe('sent');
    expect(sender.calls).toEqual([{ chatId: user.telegramId, message: MESSAGE }]);
    const [row] = await prisma.notificationDelivery.findMany();
    expect(row).toMatchObject({ status: 'SENT', kind: 'test_kind', attempts: 1, userId: user.id });
    expect(await eventRow(event.id)).toMatchObject({ status: 'DONE' });
    expect(await router.process(event.id)).toBe('duplicate');
    expect(sender.calls).toHaveLength(1);
  });

  it('429 waits retry_after; the retry sees its own delivery and sends once', async () => {
    const { event, recipient } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 7 }];
    const handler = stub(sendAnswer(recipient));
    const router = make(sender, handler);
    expect(await router.process(event.id)).toBe('retry');
    const after = await eventRow(event.id);
    expect(after.status).toBe('PENDING');
    expect(after.availableAt.getTime()).toBe(T0.getTime() + 7000);
    expect(await router.process(event.id)).toBe('sent');
    expect(handler.seen).toEqual([{ existing: false }, { existing: true }]);
    expect(sender.calls).toHaveLength(2);
  });

  it('counts an ambiguous timeout and keeps trying', async () => {
    const { event, recipient } = await setup();
    const sender = new FakeSender();
    sender.script = [new Error('socket hang up')];
    const router = make(sender, stub(sendAnswer(recipient)));
    expect(await router.process(event.id)).toBe('retry');
    const [row] = await prisma.notificationDelivery.findMany();
    expect(row).toMatchObject({ status: 'PENDING', ambiguousAttempts: 1, attempts: 1 });
  });

  it('403 flags the bot as blocked and stops', async () => {
    const { user, event, recipient } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'blocked' }];
    expect(await make(sender, stub(sendAnswer(recipient))).process(event.id)).toBe('blocked');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).botBlockedAt).toEqual(
      T0,
    );
    expect(await eventRow(event.id)).toMatchObject({ status: 'DONE' });
  });

  it('fails permanently on another 4xx', async () => {
    const { event, recipient } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    expect(await make(sender, stub(sendAnswer(recipient))).process(event.id)).toBe('failed');
    expect(await eventRow(event.id)).toMatchObject({ status: 'FAILED', lastError: 'http_400' });
  });

  it('skips a blocked account or bot without calling Telegram', async () => {
    for (const opts of [{ blocked: true }, { botBlocked: true }]) {
      await resetDatabase(prisma);
      const { event, recipient } = await setup(opts);
      const sender = new FakeSender();
      expect(await make(sender, stub(sendAnswer(recipient))).process(event.id)).toBe('skipped');
      expect(sender.calls).toHaveLength(0);
      expect((await prisma.notificationDelivery.findFirstOrThrow()).status).toBe('SKIPPED');
    }
  });

  it('waits without spending an attempt when the handler has no message (URL not configured)', async () => {
    const { event, recipient } = await setup();
    const sender = new FakeSender();
    const router = make(sender, stub(sendAnswer(recipient, { message: null })));
    expect(await router.process(event.id)).toBe('retry');
    expect(sender.calls).toHaveLength(0);
    expect((await prisma.notificationDelivery.findFirstOrThrow()).attempts).toBe(0);
  });

  it('records a handler skip as a SKIPPED delivery and closes the event', async () => {
    const { event, user } = await setup();
    const sender = new FakeSender();
    const router = make(
      sender,
      stub((e) => ({
        kind: 'skip',
        recipientId: user.id,
        deliveryKind: 'test_kind',
        dedupeKey: `test:${e.id}:telegram`,
        reason: 'revoked',
      })),
    );
    expect(await router.process(event.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    expect(await prisma.notificationDelivery.findFirstOrThrow()).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'revoked',
    });
    expect(await eventRow(event.id)).toMatchObject({ status: 'DONE' });
  });

  it('closes the event as FAILED when the handler fails, with a safe code', async () => {
    const { event } = await setup();
    const router = make(
      new FakeSender(),
      stub(() => ({ kind: 'fail', code: 'Not A Code!' })),
    );
    expect(await router.process(event.id)).toBe('failed');
    expect(await eventRow(event.id)).toMatchObject({ status: 'FAILED', lastError: 'error' });
  });

  it('runs afterCreate once, with the new delivery, and a duplicate job does not run it again', async () => {
    const { user, event, recipient } = await setup();
    let ran = 0;
    const sender = new FakeSender();
    const router = make(
      sender,
      stub(
        sendAnswer(recipient, {
          afterCreate: async (tx: { user: { update: (a: unknown) => Promise<unknown> } }) => {
            ran += 1;
            await tx.user.update({ where: { id: user.id }, data: { displayName: 'Touched' } });
          },
        }),
      ),
    );
    await router.process(event.id);
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'ENQUEUED' } });
    await router.process(event.id);
    expect(ran).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).displayName).toBe(
      'Touched',
    );
    expect(sender.calls).toHaveLength(1);
  });

  it('turns a SkipDelivery from afterCreate into a SKIPPED delivery, closes the event and sends nothing', async () => {
    const { event, recipient } = await setup();
    const sender = new FakeSender();
    const router = make(
      sender,
      stub(
        sendAnswer(recipient, {
          afterCreate: async () => {
            throw new SkipDelivery('coalesced');
          },
        }),
      ),
    );
    expect(await router.process(event.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    const rows = await prisma.notificationDelivery.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'coalesced',
      kind: 'test_kind',
    });
    expect(await eventRow(event.id)).toMatchObject({ status: 'DONE' });
  });

  it('rolls the delivery back when afterCreate throws', async () => {
    const { event, recipient } = await setup();
    const router = make(
      new FakeSender(),
      stub(
        sendAnswer(recipient, {
          afterCreate: async () => {
            throw new Error('boom');
          },
        }),
      ),
    );
    await expect(router.process(event.id)).rejects.toThrow('boom');
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });

  it('answers missing for an unknown event or a type nobody handles', async () => {
    const { event, recipient } = await setup();
    const router = make(new FakeSender(), stub(sendAnswer(recipient)));
    expect(await router.process('00000000-0000-4000-8000-000000000000')).toBe('missing');
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { type: 'other.type' } });
    expect(await router.process(event.id)).toBe('missing');
  });

  it('refuses two handlers for one event type', () => {
    const a = stub(() => ({ kind: 'fail', code: 'x' }));
    const runner = new TelegramDeliveryRunner(prisma, new FakeSender(), { miniAppUrl: undefined });
    expect(() => new NotificationRouter(prisma, runner, [a, a])).toThrow(/Two notification/);
  });
});
