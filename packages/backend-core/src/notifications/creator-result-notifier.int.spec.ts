import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BotMessage } from './creator-result-message.js';
import { CreatorResultNotifier } from './creator-result-notifier.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const T0 = new Date('2026-11-16T10:00:00.000Z');
const MINI = 'https://app.example.test';
const TOKEN = '123456:SECRET-bot-token';

class FakeSender implements TelegramSender {
  calls: { chatId: bigint; message: BotMessage }[] = [];
  script: (SendOutcome | Error)[] = [];
  inspect?: () => Promise<void>;
  async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
    await this.inspect?.();
    this.calls.push({ chatId, message });
    const next = this.script.shift() ?? { kind: 'ok', messageId: 900 + this.calls.length };
    if (next instanceof Error) throw next;
    return next;
  }
}

async function setup(
  opts: {
    decision?: 'approved' | 'rejected';
    userStatus?: 'ACTIVE' | 'BLOCKED';
    botBlocked?: boolean;
  } = {},
) {
  const decision = opts.decision ?? 'approved';
  const user = await prisma.user.create({
    data: {
      telegramId: 582917403n,
      displayName: 'Maya',
      status: opts.userStatus ?? 'ACTIVE',
      botBlockedAt: opts.botBlocked ? T0 : null,
      role: decision === 'approved' ? 'CREATOR' : 'USER',
    },
  });
  const application = await prisma.creatorApplication.create({
    data: {
      userId: user.id,
      creatorName: 'Maya',
      instagramUrl: 'https://instagram.com/maya',
      creatorType: 'HUMAN',
      description: 'd',
      status: decision === 'approved' ? 'APPROVED' : 'REJECTED',
      reviewedAt: T0,
      reviewReason: decision === 'rejected' ? 'Link <b>belum</b> valid' : null,
    },
  });
  const event = await prisma.outboxEvent.create({
    data: {
      type: `creator_application.${decision}`,
      aggregateType: 'creator_application',
      aggregateId: application.id,
      payload: { application_id: application.id, user_id: user.id, decision },
      dedupeKey: `creator_application:${application.id}:decision`,
      status: 'ENQUEUED',
      enqueuedAt: T0,
    },
  });
  return { user, application, event };
}

function make(sender: TelegramSender, now = T0) {
  return new CreatorResultNotifier(prisma, sender, { miniAppUrl: MINI, clock: () => now });
}
const eventRow = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
const deliveries = () => prisma.notificationDelivery.findMany();

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('one message per decision', () => {
  it('sends the approval to the applicant with the app button', async () => {
    const { user, event } = await setup();
    const sender = new FakeSender();
    expect(await make(sender).process(event.id)).toBe('sent');
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      chatId: user.telegramId,
      message: { buttonText: 'Buka Aplikasi', url: 'https://app.example.test/' },
    });
    expect(sender.calls[0]?.message.text).toContain('Selamat, permintaanmu disetujui');
    const [row] = await deliveries();
    expect(row).toMatchObject({
      status: 'SENT',
      attempts: 1,
      ambiguousAttempts: 0,
      telegramMessageId: 901n,
      userId: user.id,
      dedupeKey: `creator_application:${event.aggregateId}:decision:telegram`,
    });
    expect(row?.sentAt).not.toBeNull();
    expect(await eventRow(event.id)).toMatchObject({ status: 'DONE', lastError: null });
  });

  it('sends the rejection with the admin reason, read from the database', async () => {
    const { event } = await setup({ decision: 'rejected' });
    const sender = new FakeSender();
    expect(await make(sender).process(event.id)).toBe('sent');
    expect(sender.calls[0]?.message.text).toContain('Alasan dari admin: Link <b>belum</b> valid');
  });

  it('never trusts the payload: the recipient comes from the application row', async () => {
    const { user, event } = await setup();
    const other = await prisma.user.create({ data: { telegramId: 42n, displayName: 'Other' } });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        payload: { application_id: event.aggregateId, user_id: other.id, decision: 'approved' },
      },
    });
    const sender = new FakeSender();
    await make(sender).process(event.id);
    expect(sender.calls[0]?.chatId).toBe(user.telegramId);
  });
});

describe('duplicate jobs', () => {
  it('sends once when the same event is processed twice', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    const n = make(sender);
    expect(await n.process(event.id)).toBe('sent');
    expect(await n.process(event.id)).toBe('duplicate');
    expect(sender.calls).toHaveLength(1);
  });

  it('sends once when two workers process it at the same time', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.inspect = () => new Promise((r) => setTimeout(r, 30));
    const results = await Promise.all([
      make(sender).process(event.id),
      make(sender).process(event.id),
    ]);
    expect(sender.calls).toHaveLength(1);
    expect(results.sort()).toEqual(['duplicate', 'sent']);
    expect(await deliveries()).toHaveLength(1);
  });

  it('does not resend when a settled delivery meets a re-queued event', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    const n = make(sender);
    await n.process(event.id);
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PENDING' } });
    expect(await n.process(event.id)).toBe('duplicate');
    expect(sender.calls).toHaveLength(1);
    expect((await eventRow(event.id)).status).toBe('DONE');
  });

  it('answers missing for an unknown event and ignores other event types', async () => {
    const sender = new FakeSender();
    expect(await make(sender).process('00000000-0000-4000-8000-000000000000')).toBe('missing');
    const other = await prisma.outboxEvent.create({
      data: {
        type: 'x.y',
        aggregateType: 'a',
        aggregateId: '00000000-0000-4000-8000-000000000000',
        payload: {},
        dedupeKey: 'o',
      },
    });
    expect(await make(sender).process(other.id)).toBe('missing');
    expect(sender.calls).toHaveLength(0);
  });
});

describe('Telegram outcomes', () => {
  it('429 then success: waits retry_after, then sends once', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 7 }];
    expect(await make(sender).process(event.id)).toBe('retry');
    let ev = await eventRow(event.id);
    expect(ev.status).toBe('PENDING');
    expect(ev.availableAt.toISOString()).toBe(new Date(T0.getTime() + 7000).toISOString());
    expect((await deliveries())[0]).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastErrorCode: 'rate_limited',
    });

    expect(await make(sender, new Date(T0.getTime() + 8000)).process(event.id)).toBe('sent');
    ev = await eventRow(event.id);
    expect(ev.status).toBe('DONE');
    expect((await deliveries())[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(sender.calls).toHaveLength(2);
  });

  it('clamps an absurd retry_after to one hour', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 10_000_000 }];
    await make(sender).process(event.id);
    expect((await eventRow(event.id)).availableAt.toISOString()).toBe(
      new Date(T0.getTime() + 3_600_000).toISOString(),
    );
  });

  it('403 marks the bot blocked, does not retry, and later notifications are skipped', async () => {
    const { user, event } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'blocked' }];
    expect(await make(sender).process(event.id)).toBe('blocked');
    expect((await deliveries())[0]).toMatchObject({ status: 'BOT_BLOCKED', attempts: 1 });
    expect((await eventRow(event.id)).status).toBe('DONE');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).botBlockedAt,
    ).not.toBeNull();

    // A later decision for the same user (a new application) is skipped without a send.
    const app2 = await prisma.creatorApplication.create({
      data: {
        userId: user.id,
        creatorName: 'M',
        instagramUrl: 'https://instagram.com/m',
        creatorType: 'HUMAN',
        description: 'd',
        status: 'REJECTED',
        reviewedAt: T0,
        reviewReason: 'r',
      },
    });
    const ev2 = await prisma.outboxEvent.create({
      data: {
        type: 'creator_application.rejected',
        aggregateType: 'creator_application',
        aggregateId: app2.id,
        payload: {},
        dedupeKey: 'k2',
      },
    });
    expect(await make(sender).process(ev2.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(1);
    expect(
      (await prisma.notificationDelivery.findFirstOrThrow({ where: { outboxEventId: ev2.id } }))
        .status,
    ).toBe('SKIPPED');
  });

  it('other 4xx fails without retry', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    expect(await make(sender).process(event.id)).toBe('failed');
    expect((await deliveries())[0]).toMatchObject({ status: 'FAILED', lastErrorCode: 'http_400' });
    expect(await eventRow(event.id)).toMatchObject({ status: 'FAILED', lastError: 'http_400' });
  });

  it('5xx backs off; ambiguous results are counted; success comes on a later attempt', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.script = [
      { kind: 'transient', code: 'http_502' },
      { kind: 'ambiguous', code: 'timeout' },
    ];
    expect(await make(sender).process(event.id)).toBe('retry');
    expect((await eventRow(event.id)).availableAt.toISOString()).toBe(
      new Date(T0.getTime() + 5_000).toISOString(),
    );
    const t1 = new Date(T0.getTime() + 10_000);
    expect(await make(sender, t1).process(event.id)).toBe('retry');
    expect((await eventRow(event.id)).availableAt.toISOString()).toBe(
      new Date(t1.getTime() + 30_000).toISOString(),
    );
    expect((await deliveries())[0]).toMatchObject({
      status: 'PENDING',
      attempts: 2,
      ambiguousAttempts: 1,
      lastErrorCode: 'timeout',
    });
    expect(await make(sender, new Date(t1.getTime() + 60_000)).process(event.id)).toBe('sent');
    expect((await deliveries())[0]).toMatchObject({
      status: 'SENT',
      attempts: 3,
      ambiguousAttempts: 1,
    });
  });

  it('gives up at the attempt cap', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.script = Array.from(
      { length: 10 },
      () => ({ kind: 'transient', code: 'http_500' }) as const,
    );
    let result = 'retry';
    for (let i = 0; i < 10; i += 1) {
      result = await make(sender, new Date(T0.getTime() + i * 3 * 3_600_000)).process(event.id);
    }
    expect(result).toBe('failed');
    expect(sender.calls).toHaveLength(10);
    expect(await eventRow(event.id)).toMatchObject({ status: 'FAILED', lastError: 'max_attempts' });
    expect((await deliveries())[0]).toMatchObject({ status: 'FAILED', attempts: 10 });
  });
});

describe('eligibility', () => {
  it('skips a blocked account without calling Telegram', async () => {
    const { event } = await setup({ userStatus: 'BLOCKED' });
    const sender = new FakeSender();
    expect(await make(sender).process(event.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    expect((await deliveries())[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'account_blocked',
    });
    expect((await eventRow(event.id)).status).toBe('DONE');
  });

  it('skips a user who blocked the bot', async () => {
    const { event } = await setup({ botBlocked: true });
    const sender = new FakeSender();
    expect(await make(sender).process(event.id)).toBe('skipped');
    expect((await deliveries())[0]).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'bot_blocked',
    });
  });

  it('fails on a decision/status mismatch and sends nothing', async () => {
    const { application, event } = await setup();
    await prisma.creatorApplication.update({
      where: { id: application.id },
      data: { status: 'REJECTED', reviewedAt: T0, reviewReason: 'r' },
    });
    const sender = new FakeSender();
    expect(await make(sender).process(event.id)).toBe('failed');
    expect(sender.calls).toHaveLength(0);
    expect(await eventRow(event.id)).toMatchObject({
      status: 'FAILED',
      lastError: 'decision_mismatch',
    });
  });

  it('waits, spending no attempt, when the Mini App URL is not configured', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    const n = new CreatorResultNotifier(prisma, sender, { miniAppUrl: undefined, clock: () => T0 });
    expect(await n.process(event.id)).toBe('retry');
    expect(sender.calls).toHaveLength(0);
    expect((await deliveries())[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect((await eventRow(event.id)).status).toBe('PENDING');
  });
});

describe('safety', () => {
  it('keeps a token inside a thrown sender error out of every row', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    sender.script = [
      new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`),
    ];
    expect(await make(sender).process(event.id)).toBe('retry');
    const dump = JSON.stringify(
      [await deliveries(), await prisma.outboxEvent.findMany()],
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(dump).not.toContain('SECRET');
    expect((await deliveries())[0]).toMatchObject({
      status: 'PENDING',
      ambiguousAttempts: 1,
      lastErrorCode: 'sender_error',
    });
  });

  it('never calls the sender inside an open transaction', async () => {
    const { event } = await setup();
    const sender = new FakeSender();
    let open = -1;
    sender.inspect = async () => {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
      open = Number(rows[0]?.n);
    };
    await make(sender).process(event.id);
    expect(open).toBe(0);
  });

  it('leaves the application and the role untouched on every outcome', async () => {
    const outcomes: SendOutcome[] = [
      { kind: 'blocked' },
      { kind: 'permanent', code: 'http_400' },
      { kind: 'ambiguous', code: 'timeout' },
    ];
    for (const outcome of outcomes) {
      await resetDatabase(prisma);
      const { user, application, event } = await setup();
      const sender = new FakeSender();
      sender.script = [outcome];
      await make(sender).process(event.id);
      expect(
        await prisma.creatorApplication.findUniqueOrThrow({ where: { id: application.id } }),
      ).toMatchObject({ status: 'APPROVED' });
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(u).toMatchObject({ role: 'CREATOR', status: 'ACTIVE', sessionVersion: 1 });
    }
  });
});
