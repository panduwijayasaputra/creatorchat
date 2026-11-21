import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { accessReminderHandler } from './access-reminder-handler.js';
import { AccessScheduleService } from './access-schedule.service.js';
import type { BotMessage } from './creator-result-message.js';
import { TelegramDeliveryRunner } from './delivery-runner.js';
import { NotificationRouter } from './notification-router.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const DAY = 86_400_000;
const HOUR = 3_600_000;
// 12.00 in Jakarta; a grant ends at the end of the admin's day, here 21 Nov 23.59 + a few days
const NOW = new Date('2026-11-21T05:00:00.000Z');
const MINI = 'https://app.example.test';
let clock = NOW;
const at = (ms: number) => new Date(NOW.getTime() + ms);

class FakeSender implements TelegramSender {
  calls: { chatId: bigint; message: BotMessage }[] = [];
  script: (SendOutcome | Error)[] = [];
  async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
    this.calls.push({ chatId, message });
    const next = this.script.shift() ?? { kind: 'ok', messageId: 900 + this.calls.length };
    if (next instanceof Error) throw next;
    return next;
  }
}

const router = (sender: TelegramSender) =>
  new NotificationRouter(
    prisma,
    new TelegramDeliveryRunner(prisma, sender, { miniAppUrl: MINI, clock: () => clock }),
    [accessReminderHandler],
  );

let n = 82_000n;
beforeEach(async () => {
  clock = NOW;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

async function setup(over: { endsIn?: number; timezone?: string } = {}) {
  const customer = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka Putra', timezone: over.timezone ?? 'Asia/Jakarta' },
  });
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: 'jjjjjjjj' },
  });
  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId: creator.id,
      startsAt: at(-30 * DAY),
      endsAt: at(over.endsIn ?? 2 * DAY),
    },
  });
  return { customer, owner, creator, subscription };
}

/** Runs the real scanner at `when` and returns the event it wrote. */
async function scanned(type: 'subscription.reminder_due' | 'subscription.ended', when = NOW) {
  await new AccessScheduleService(prisma, new OutboxService(), {
    leadDays: 3,
    clock: () => when,
  }).scan(when);
  return prisma.outboxEvent.findFirstOrThrow({ where: { type }, orderBy: { createdAt: 'desc' } });
}
const deliveries = () => prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'asc' } });

describe('Pengingat akses', () => {
  it('tells the customer the end date in their timezone, with a button to Langganan', async () => {
    const s = await setup({ endsIn: 2 * DAY });
    const event = await scanned('subscription.reminder_due');
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('sent');
    expect(sender.calls).toEqual([
      {
        chatId: s.customer.telegramId,
        message: {
          text: 'Halo Raka Putra, aksesmu ke Salsa Maheswari berakhir 23 Nov 2026, 12.00 WIB. Hubungi admin bila ingin memperpanjang.',
          buttonText: 'Buka Aplikasi',
          url: `${MINI}/subscriptions`,
        },
      },
    ]);
    expect((await deliveries())[0]).toMatchObject({ kind: 'access_reminder', status: 'SENT' });
  });

  it('uses the customer timezone', async () => {
    await setup({ endsIn: 2 * DAY, timezone: 'Asia/Jayapura' });
    const event = await scanned('subscription.reminder_due');
    const sender = new FakeSender();
    await router(sender).process(event.id);
    expect(sender.calls[0]?.message.text).toContain('23 Nov 2026, 14.00 WIT');
  });

  it('is skipped when the access was extended after the scan, and the new end gets its own', async () => {
    const s = await setup({ endsIn: 2 * DAY });
    const event = await scanned('subscription.reminder_due');
    await prisma.subscription.update({
      where: { id: s.subscription.id },
      data: { endsAt: at(20 * DAY) },
    });
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    expect((await deliveries())[0]?.lastErrorCode).toBe('extended');
  });

  it('is skipped when revoked, when it would come after the end, and when the creator is blocked', async () => {
    for (const change of ['revoked', 'ended', 'creator'] as const) {
      await resetDatabase(prisma);
      const s = await setup({ endsIn: 2 * DAY });
      const event = await scanned('subscription.reminder_due');
      if (change === 'revoked') {
        await prisma.subscription.update({
          where: { id: s.subscription.id },
          data: { revokedAt: NOW },
        });
      }
      if (change === 'ended') clock = at(2 * DAY + HOUR);
      if (change === 'creator') {
        await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
      }
      const sender = new FakeSender();
      expect(await router(sender).process(event.id), change).toBe('skipped');
      expect(sender.calls).toHaveLength(0);
      clock = NOW;
    }
    expect((await deliveries()).map((d) => d.lastErrorCode)).toEqual(['creator_blocked']);
  });

  it('is skipped for a blocked customer and a customer who blocked the bot', async () => {
    for (const block of ['customer', 'bot'] as const) {
      await resetDatabase(prisma);
      const s = await setup({ endsIn: 2 * DAY });
      const event = await scanned('subscription.reminder_due');
      await prisma.user.update({
        where: { id: s.customer.id },
        data: block === 'customer' ? { status: 'BLOCKED' } : { botBlockedAt: NOW },
      });
      const sender = new FakeSender();
      expect(await router(sender).process(event.id), block).toBe('skipped');
      expect(sender.calls).toHaveLength(0);
    }
  });
});

describe('Akses berakhir', () => {
  it('tells the customer it ended, without a date', async () => {
    const s = await setup({ endsIn: -HOUR });
    const event = await scanned('subscription.ended');
    const sender = new FakeSender();
    expect(await router(sender).process(event.id)).toBe('sent');
    expect(sender.calls[0]).toEqual({
      chatId: s.customer.telegramId,
      message: {
        text: 'Halo Raka Putra, aksesmu ke Salsa Maheswari sudah berakhir. Terima kasih sudah bergabung.',
        buttonText: 'Buka Aplikasi',
        url: `${MINI}/subscriptions`,
      },
    });
    expect((await deliveries())[0]).toMatchObject({ kind: 'access_ended', status: 'SENT' });
  });

  it('is skipped when the access was extended again, revoked, or has not ended yet', async () => {
    const extended = await setup({ endsIn: -HOUR });
    const e1 = await scanned('subscription.ended');
    await prisma.subscription.update({
      where: { id: extended.subscription.id },
      data: { endsAt: at(10 * DAY) },
    });
    const sender = new FakeSender();
    expect(await router(sender).process(e1.id)).toBe('skipped');

    await resetDatabase(prisma);
    const revoked = await setup({ endsIn: -HOUR });
    const e2 = await scanned('subscription.ended');
    await prisma.subscription.update({
      where: { id: revoked.subscription.id },
      data: { revokedAt: NOW },
    });
    expect(await router(sender).process(e2.id)).toBe('skipped');

    await resetDatabase(prisma);
    await setup({ endsIn: -HOUR });
    const e3 = await scanned('subscription.ended');
    clock = at(-2 * DAY); // the delivery clock is before the end: it cannot have ended
    expect(await router(sender).process(e3.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
  });
});

describe('delivery rules shared with the other notices', () => {
  it('a duplicate job sends once; a 429 and an ambiguous timeout are retried; a forged end time is skipped', async () => {
    await setup({ endsIn: 2 * DAY });
    const event = await scanned('subscription.reminder_due');
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 2 }, new Error('timeout')];
    const r = router(sender);
    expect(await r.process(event.id)).toBe('retry');
    expect(await r.process(event.id)).toBe('retry');
    expect(await r.process(event.id)).toBe('sent');
    expect(await r.process(event.id)).toBe('duplicate');
    expect(sender.calls).toHaveLength(3);
    expect((await deliveries())[0]).toMatchObject({
      attempts: 3,
      ambiguousAttempts: 1,
      status: 'SENT',
    });
  });

  it("a payload end time that is not the subscription's is skipped, and a payload without one fails", async () => {
    await setup({ endsIn: 2 * DAY });
    const event = await scanned('subscription.reminder_due');
    const sender = new FakeSender();
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { payload: { ...(event.payload as object), ends_at: at(9 * DAY).toISOString() } },
    });
    expect(await router(sender).process(event.id)).toBe('skipped');
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'ENQUEUED', payload: {} },
    });
    expect(await router(sender).process(event.id)).toBe('failed');
    expect(sender.calls).toHaveLength(0);
  });

  it('a permanent failure leaves the subscription untouched', async () => {
    const s = await setup({ endsIn: 2 * DAY });
    const event = await scanned('subscription.reminder_due');
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    expect(await router(sender).process(event.id)).toBe('failed');
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: s.subscription.id } });
    expect(after.endsAt).toEqual(s.subscription.endsAt);
    expect(after.revokedAt).toBeNull();
  });
});
