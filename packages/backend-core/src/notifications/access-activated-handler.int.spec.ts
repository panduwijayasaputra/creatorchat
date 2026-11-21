import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { SubscriptionAccessService } from '../subscription-access/subscription-access.service.js';
import { accessActivatedHandler } from './access-activated-handler.js';
import type { BotMessage } from './creator-result-message.js';
import { TelegramDeliveryRunner } from './delivery-runner.js';
import { NotificationRouter } from './notification-router.js';
import type { SendOutcome, TelegramSender } from './telegram-sender.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-21T05:00:00.000Z'); // 12.00 in Jakarta
const access = new SubscriptionAccessService(prisma, new OutboxService(), () => now);
const MINI = 'https://app.example.test';

class FakeSender implements TelegramSender {
  calls: { chatId: bigint; message: BotMessage }[] = [];
  script: (SendOutcome | Error)[] = [];
  async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
    this.calls.push({ chatId, message });
    const next = this.script.shift() ?? { kind: 'ok', messageId: 700 + this.calls.length };
    if (next instanceof Error) throw next;
    return next;
  }
}

const router = (sender: TelegramSender) =>
  new NotificationRouter(
    prisma,
    new TelegramDeliveryRunner(prisma, sender, { miniAppUrl: MINI, clock: () => now }),
    [accessActivatedHandler],
  );

let n = 61_000n;
let adminId = '';
const ctx = () => ({ adminId, reason: 'Kompensasi gangguan layanan.', requestId: 'req-1' });

beforeEach(async () => {
  now = new Date('2026-11-21T05:00:00.000Z');
  await resetDatabase(prisma);
  adminId = (
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
  ).id;
});
afterAll(() => prisma.$disconnect());

async function setup(opts: { timezone?: string } = {}) {
  const customer = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka Putra', timezone: opts.timezone ?? 'Asia/Jakarta' },
  });
  const creatorUser = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa Maheswari', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: creatorUser.id, publicCode: 'aaaaaaab' },
  });
  const granted = await access.grant(
    customer.id,
    { creatorId: creator.id, durationDays: 30 },
    ctx(),
  );
  if (granted.kind !== 'ok') throw new Error(granted.kind);
  return { customer, creatorUser, creator, sub: granted.subscription };
}

const eventsOf = (type: string) =>
  prisma.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });

describe('Akses diaktifkan', () => {
  it('tells the customer the end date in their timezone, with a button to the chat', async () => {
    const { customer, sub } = await setup();
    const [event] = await eventsOf('subscription.granted');
    const sender = new FakeSender();
    expect(await router(sender).process(event!.id)).toBe('sent');
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    expect(sender.calls).toEqual([
      {
        chatId: customer.telegramId,
        message: {
          text: 'Halo Raka Putra, aksesmu ke Salsa Maheswari sudah aktif sampai 21 Des 2026, 23.59 WIB. Selamat mengobrol.',
          buttonText: 'Buka Aplikasi',
          url: `${MINI}/chats/${conversation.id}`,
        },
      },
    ]);
    expect(sub.endsAt.toISOString()).toBe('2026-12-21T16:59:59.000Z'); // the admin zone's end of day
    const [row] = await prisma.notificationDelivery.findMany();
    expect(row).toMatchObject({
      status: 'SENT',
      kind: 'access_activated',
      dedupeKey: expect.stringMatching(/^subscription_event:[0-9a-f-]{36}:telegram$/),
    });
  });

  it('uses the customer timezone', async () => {
    await setup({ timezone: 'Asia/Jayapura' });
    const [event] = await eventsOf('subscription.granted');
    const sender = new FakeSender();
    await router(sender).process(event!.id);
    expect(sender.calls[0]?.message.text).toContain('22 Des 2026, 01.59 WIT');
  });

  it('sends a second notice for an extension, with the new end date', async () => {
    const { customer, sub } = await setup();
    const sender = new FakeSender();
    const [granted] = await eventsOf('subscription.granted');
    await router(sender).process(granted!.id);
    const ext = await access.extend(customer.id, sub.id, { durationDays: 10 }, ctx());
    expect(ext.kind).toBe('ok');
    const [extended] = await eventsOf('subscription.extended');
    expect(await router(sender).process(extended!.id)).toBe('sent');
    expect(sender.calls).toHaveLength(2);
    expect(sender.calls[1]?.message.text).toContain('31 Des 2026, 23.59 WIB');
    expect(await prisma.notificationDelivery.count()).toBe(2);
  });

  it('skips when the access was revoked or has ended before delivery', async () => {
    const { customer, sub } = await setup();
    const [event] = await eventsOf('subscription.granted');
    await access.revoke(customer.id, sub.id, ctx());
    const sender = new FakeSender();
    expect(await router(sender).process(event!.id)).toBe('skipped');
    expect(sender.calls).toHaveLength(0);
    expect(await prisma.notificationDelivery.findFirstOrThrow()).toMatchObject({
      status: 'SKIPPED',
      lastErrorCode: 'revoked',
    });

    await resetDatabase(prisma);
    adminId = (
      await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
    ).id;
    await setup();
    const [again] = await eventsOf('subscription.granted');
    now = new Date('2027-01-30T00:00:00.000Z');
    expect(await router(sender).process(again!.id)).toBe('skipped');
    expect((await prisma.notificationDelivery.findFirstOrThrow()).lastErrorCode).toBe('ended');
  });

  it('skips a blocked creator, a blocked customer and a customer who blocked the bot', async () => {
    for (const block of ['creator', 'customer', 'bot'] as const) {
      await resetDatabase(prisma);
      adminId = (
        await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
      ).id;
      const s = await setup();
      if (block === 'creator') {
        await prisma.creator.update({ where: { id: s.creator.id }, data: { status: 'BLOCKED' } });
      }
      if (block === 'customer') {
        await prisma.user.update({ where: { id: s.customer.id }, data: { status: 'BLOCKED' } });
      }
      if (block === 'bot') {
        await prisma.user.update({ where: { id: s.customer.id }, data: { botBlockedAt: now } });
      }
      const [event] = await eventsOf('subscription.granted');
      const sender = new FakeSender();
      expect(await router(sender).process(event!.id), block).toBe('skipped');
      expect(sender.calls).toHaveLength(0);
    }
  });

  it('fails, sending nothing, when the payload names an access event of another subscription', async () => {
    const { customer, sub } = await setup();
    const other = await prisma.user.create({ data: { telegramId: n++, displayName: 'Other' } });
    const creatorUser = await prisma.user.create({
      data: { telegramId: n++, displayName: 'Dinda', role: 'CREATOR' },
    });
    const creator2 = await prisma.creator.create({
      data: { userId: creatorUser.id, publicCode: 'aaaaaaac' },
    });
    await access.grant(other.id, { creatorId: creator2.id, durationDays: 5 }, ctx());
    const events = await eventsOf('subscription.granted');
    const forged = events[0]!;
    const foreign = events[1]!;
    const foreignPayload = foreign.payload as { event_id: string };
    await prisma.outboxEvent.update({
      where: { id: forged.id },
      data: { payload: { ...(forged.payload as object), event_id: foreignPayload.event_id } },
    });
    const sender = new FakeSender();
    expect(await router(sender).process(forged.id)).toBe('failed');
    expect(sender.calls).toHaveLength(0);
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: forged.id } })).lastError,
    ).toBe('event_missing');
    void customer;
    void sub;
  });

  it('sends once for a duplicate job and survives 429 and an ambiguous timeout', async () => {
    await setup();
    const [event] = await eventsOf('subscription.granted');
    const sender = new FakeSender();
    sender.script = [{ kind: 'rate_limited', retryAfterSeconds: 3 }, new Error('timeout')];
    const r = router(sender);
    expect(await r.process(event!.id)).toBe('retry');
    expect(await r.process(event!.id)).toBe('retry');
    expect(await r.process(event!.id)).toBe('sent');
    expect(await r.process(event!.id)).toBe('duplicate');
    expect(sender.calls).toHaveLength(3);
    const [row] = await prisma.notificationDelivery.findMany();
    expect(row).toMatchObject({ status: 'SENT', attempts: 3, ambiguousAttempts: 1 });
  });

  it('leaves the subscription untouched when Telegram fails for good', async () => {
    const { customer, sub } = await setup();
    const [event] = await eventsOf('subscription.granted');
    const sender = new FakeSender();
    sender.script = [{ kind: 'permanent', code: 'http_400' }];
    expect(await router(sender).process(event!.id)).toBe('failed');
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.endsAt).toEqual(sub.endsAt);
    expect(after.revokedAt).toBeNull();
    void customer;
  });
});
