import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { isEntitled } from './entitlement.js';
import { SubscriptionAccessService } from './subscription-access.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-16T05:00:00.000Z'); // 12:00 in Jakarta
const service = new SubscriptionAccessService(prisma, new OutboxService(), () => now);

let n = 50_000n;
let codeNo = 0;
let adminId = '';
const ctx = (reason = 'Kompensasi gangguan layanan.') => ({ adminId, reason, requestId: 'req-1' });

beforeEach(async () => {
  now = new Date('2026-11-16T05:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
  adminId = (
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
  ).id;
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Raka Putra', ...data } });

const makeCreator = async (status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') => {
  const user = await makeUser({ role: 'CREATOR', displayName: `Creator ${codeNo}` });
  return prisma.creator.create({
    data: { userId: user.id, publicCode: `aaaaaaa${'abcdefgh'[codeNo++]}`, status },
  });
};

const days = (d: number, from = now) => new Date(from.getTime() + d * 86_400_000);
const counts = async () => ({
  subs: await prisma.subscription.count(),
  events: await prisma.subscriptionEvent.count(),
  audit: await prisma.auditLog.count(),
  outbox: await prisma.outboxEvent.count(),
  conv: await prisma.conversation.count(),
});

const grant = (userId: string, creatorId: string, extra: object = {}) =>
  service.grant(userId, { creatorId, durationDays: 30, ...extra }, ctx());

async function setup() {
  const user = await makeUser();
  const creator = await makeCreator();
  return { user, creator };
}

async function granted() {
  const s = await setup();
  const r = await grant(s.user.id, s.creator.id);
  if (r.kind !== 'ok') throw new Error(r.kind);
  return { ...s, sub: r.subscription };
}

describe('grant', () => {
  it('creates the subscription, event, audit, outbox event and conversation', async () => {
    const { user, creator } = await setup();
    const r = await grant(user.id, creator.id);
    expect(r.kind).toBe('ok');
    const sub = await prisma.subscription.findFirstOrThrow();
    expect(sub.endsAt.toISOString()).toBe('2026-12-16T16:59:59.000Z'); // 23:59:59 Jakarta
    expect(isEntitled(sub, now)).toBe(true);

    const event = await prisma.subscriptionEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      type: 'GRANT',
      adminId,
      reason: 'Kompensasi gangguan layanan.',
      previousEndsAt: null,
    });
    expect(event.newEndsAt?.toISOString()).toBe(sub.endsAt.toISOString());

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'subscription.granted' },
    });
    expect(audit).toMatchObject({
      actorType: 'ADMIN',
      actorId: adminId,
      targetType: 'subscription',
      targetId: sub.id,
      reason: 'Kompensasi gangguan layanan.',
      requestId: 'req-1',
    });

    expect(event.auditLogId).toBe(audit.id);

    const outbox = await prisma.outboxEvent.findFirstOrThrow({
      where: { type: 'subscription.granted' },
    });
    expect(outbox).toMatchObject({
      type: 'subscription.granted',
      status: 'PENDING',
      dedupeKey: `subscription_event:${event.id}`,
    });
    expect(JSON.stringify(outbox.payload)).not.toContain('Kompensasi');

    expect(await prisma.conversation.findFirstOrThrow()).toMatchObject({
      customerId: user.id,
      creatorId: creator.id,
      mode: 'MANUAL',
    });
  });

  it('accepts a custom end date at 23:59:59 Jakarta', async () => {
    const { user, creator } = await setup();
    const r = await service.grant(user.id, { creatorId: creator.id, endDate: '2026-12-31' }, ctx());
    expect(r.kind === 'ok' && r.subscription.endsAt.toISOString()).toBe('2026-12-31T16:59:59.000Z');
  });

  it('refuses a custom end date of today, in the past, or beyond 400 days', async () => {
    const { user, creator } = await setup();
    for (const endDate of ['2026-11-16', '2026-11-01', '2028-01-01', '2026-02-30']) {
      const r = await service.grant(user.id, { creatorId: creator.id, endDate }, ctx());
      expect(r.kind).toBe('invalid');
    }
    expect(await counts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0, conv: 0 });
  });

  it('grants a second creator to the same user', async () => {
    const { user, creator } = await setup();
    const other = await makeCreator();
    expect((await grant(user.id, creator.id)).kind).toBe('ok');
    expect((await grant(user.id, other.id)).kind).toBe('ok');
    expect(await prisma.subscription.count()).toBe(2);
  });

  it('refuses a grant while the pair is active and writes nothing', async () => {
    const { user, creator } = await granted();
    const before = await counts();
    expect((await grant(user.id, creator.id)).kind).toBe('subscription_active');
    expect(await counts()).toEqual(before);
  });

  it('re-grants after expiry on the same row and keeps the earlier events', async () => {
    const { user, creator, sub } = await granted();
    now = days(40);
    expect(isEntitled(await prisma.subscription.findFirstOrThrow(), now)).toBe(false);
    const r = await grant(user.id, creator.id);
    expect(r.kind === 'ok' && r.subscription.id).toBe(sub.id);
    expect(await prisma.subscription.count()).toBe(1);
    const events = await prisma.subscriptionEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['GRANT', 'GRANT']);
    expect(events[1]?.previousEndsAt?.toISOString()).toBe(sub.endsAt.toISOString());
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('re-grants after a revoke: revoked_at cleared, access active again', async () => {
    const { user, creator, sub } = await granted();
    await service.revoke(user.id, sub.id, ctx('Pelanggaran.'));
    const r = await grant(user.id, creator.id);
    expect(r.kind).toBe('ok');
    const row = await prisma.subscription.findFirstOrThrow();
    expect(row.revokedAt).toBeNull();
    expect(isEntitled(row, now)).toBe(true);
    expect((await prisma.subscriptionEvent.findMany()).map((e) => e.type).sort()).toEqual([
      'GRANT',
      'GRANT',
      'REVOKE',
    ]);
  });

  it('refuses a CREATOR account, a BLOCKED user, a BLOCKED or unknown creator', async () => {
    const creator = await makeCreator();
    const creatorUser = await prisma.user.findFirstOrThrow({ where: { id: creator.userId } });
    expect((await grant(creatorUser.id, creator.id)).kind).toBe('user_role_conflict');

    const blocked = await makeUser({ status: 'BLOCKED' });
    expect((await grant(blocked.id, creator.id)).kind).toBe('user_status_conflict');

    const user = await makeUser();
    const blockedCreator = await makeCreator('BLOCKED');
    expect((await grant(user.id, blockedCreator.id)).kind).toBe('creator_not_active');
    expect((await grant(user.id, '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33')).kind).toBe('not_found');
    expect((await grant(user.id, 'nope')).kind).toBe('not_found');
    expect(await counts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0, conv: 0 });
  });

  it('treats a creator id or admin id as an unknown user', async () => {
    const { creator } = await setup();
    expect((await grant(creator.id, creator.id)).kind).toBe('not_found');
    expect((await grant(adminId, creator.id)).kind).toBe('not_found');
  });

  it('a first grant also asks for the welcome message, with ids only', async () => {
    const { user, creator } = await setup();
    await grant(user.id, creator.id);
    const sub = await prisma.subscription.findFirstOrThrow();
    const events = await prisma.outboxEvent.findMany({ where: { type: 'welcome.requested' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregateType: 'subscription',
      aggregateId: sub.id,
      status: 'PENDING',
      dedupeKey: `welcome:${creator.id}:${user.id}`,
      payload: { subscription_id: sub.id, customer_id: user.id, creator_id: creator.id },
    });
    expect(JSON.stringify(events[0]?.payload)).not.toContain('Kompensasi');
  });

  it("a grant for a second creator asks for that creator's welcome message too", async () => {
    const first = await setup();
    await grant(first.user.id, first.creator.id);
    const other = await makeCreator();
    await grant(first.user.id, other.id);
    const keys = (await prisma.outboxEvent.findMany({ where: { type: 'welcome.requested' } })).map(
      (e) => e.dedupeKey,
    );
    expect(keys.sort()).toEqual(
      [
        `welcome:${first.creator.id}:${first.user.id}`,
        `welcome:${other.id}:${first.user.id}`,
      ].sort(),
    );
  });

  it('extend, revoke and a re-grant after an expiry or a revoke ask for no welcome message', async () => {
    const { user, creator, sub } = await granted();
    await service.extend(user.id, sub.id, { durationDays: 10 }, ctx());
    await service.revoke(user.id, sub.id, ctx('Pelanggaran.'));
    await grant(user.id, creator.id); // after the revoke
    now = days(90);
    await grant(user.id, creator.id); // after the expiry
    expect(await prisma.outboxEvent.count({ where: { type: 'welcome.requested' } })).toBe(1);
  });

  it('two parallel first grants ask once', async () => {
    const { user, creator } = await setup();
    await Promise.all([grant(user.id, creator.id), grant(user.id, creator.id)]);
    expect(await prisma.outboxEvent.count({ where: { type: 'welcome.requested' } })).toBe(1);
  });

  it('writes exactly one row, event and conversation for two parallel grants', async () => {
    const { user, creator } = await setup();
    const results = await Promise.all([grant(user.id, creator.id), grant(user.id, creator.id)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['ok', 'subscription_active']);
    // the access event and, because it is the first access, the request for the welcome message
    expect(await counts()).toEqual({ subs: 1, events: 1, audit: 1, outbox: 2, conv: 1 });
  });

  it('rolls everything back when a step fails', async () => {
    const { user, creator } = await setup();
    const broken = new SubscriptionAccessService(
      prisma,
      { add: () => Promise.reject(new Error('boom')) } as unknown as OutboxService,
      () => now,
    );
    await expect(
      broken.grant(user.id, { creatorId: creator.id, durationDays: 30 }, ctx()),
    ).rejects.toThrow('boom');
    expect(await counts()).toEqual({ subs: 0, events: 0, audit: 0, outbox: 0, conv: 0 });
  });
});

describe('extend', () => {
  it('moves ends_at by the chosen days from the current end and records both dates', async () => {
    const { user, sub } = await granted();
    const r = await service.extend(user.id, sub.id, { durationDays: 30 }, ctx('Permintaan user.'));
    expect(r.kind === 'ok' && r.subscription.endsAt.toISOString()).toBe('2027-01-15T16:59:59.000Z');
    const event = await prisma.subscriptionEvent.findFirstOrThrow({ where: { type: 'EXTEND' } });
    expect(event.previousEndsAt?.toISOString()).toBe('2026-12-16T16:59:59.000Z');
    expect(event.newEndsAt?.toISOString()).toBe('2027-01-15T16:59:59.000Z');
    expect(event.reason).toBe('Permintaan user.');
    expect(
      await prisma.auditLog.count({
        where: { action: 'subscription.extended', reason: 'Permintaan user.' },
      }),
    ).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: 'subscription.extended' } })).toBe(1);
  });

  it('extends an expired row from now', async () => {
    const { user, sub } = await granted();
    now = days(60);
    const r = await service.extend(user.id, sub.id, { durationDays: 7 }, ctx());
    expect(r.kind === 'ok' && r.subscription.status).toBe('ACTIVE');
    expect(r.kind === 'ok' && r.subscription.endsAt.toISOString()).toBe('2027-01-22T16:59:59.000Z');
  });

  it('refuses a revoked row', async () => {
    const { user, sub } = await granted();
    await service.revoke(user.id, sub.id, ctx());
    const before = await counts();
    expect((await service.extend(user.id, sub.id, { durationDays: 7 }, ctx())).kind).toBe(
      'subscription_revoked',
    );
    expect(await counts()).toEqual(before);
  });

  it("returns not_found for another user's subscription, a malformed or unknown id", async () => {
    const { sub } = await granted();
    const other = await makeUser();
    expect((await service.extend(other.id, sub.id, { durationDays: 7 }, ctx())).kind).toBe(
      'not_found',
    );
    expect((await service.extend(other.id, 'nope', { durationDays: 7 }, ctx())).kind).toBe(
      'not_found',
    );
    expect(
      (
        await service.extend(
          other.id,
          '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
          { durationDays: 7 },
          ctx(),
        )
      ).kind,
    ).toBe('not_found');
    expect(await prisma.subscriptionEvent.count({ where: { type: 'EXTEND' } })).toBe(0);
  });
});

describe('revoke', () => {
  it('ends access immediately and keeps the conversation', async () => {
    const { user, sub } = await granted();
    const r = await service.revoke(user.id, sub.id, ctx('Pelanggaran ketentuan layanan.'));
    expect(r.kind === 'ok' && r.subscription.status).toBe('REVOKED');
    const row = await prisma.subscription.findFirstOrThrow();
    expect(isEntitled(row, now)).toBe(false);
    expect(row.revokedAt?.toISOString()).toBe(now.toISOString());
    expect(row.endsAt.toISOString()).toBe(sub.endsAt.toISOString());
    expect(await prisma.conversation.count()).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'subscription.revoked', reason: 'Pelanggaran ketentuan layanan.' },
      }),
    ).toBe(1);
  });

  it('acts once for a repeat and refuses an expired row', async () => {
    const { user, sub } = await granted();
    expect((await service.revoke(user.id, sub.id, ctx())).kind).toBe('ok');
    expect((await service.revoke(user.id, sub.id, ctx())).kind).toBe('subscription_not_active');
    expect(await prisma.subscriptionEvent.count({ where: { type: 'REVOKE' } })).toBe(1);

    const again = await granted();
    now = days(60);
    expect((await service.revoke(again.user.id, again.sub.id, ctx())).kind).toBe(
      'subscription_not_active',
    );
  });

  it("returns not_found for another user's subscription", async () => {
    const { sub } = await granted();
    const other = await makeUser();
    expect((await service.revoke(other.id, sub.id, ctx())).kind).toBe('not_found');
    expect((await prisma.subscription.findFirstOrThrow()).revokedAt).toBeNull();
  });

  it('serialises a parallel extend and revoke: events match the final state', async () => {
    const { user, sub } = await granted();
    const [e, r] = await Promise.all([
      service.extend(user.id, sub.id, { durationDays: 7 }, ctx()),
      service.revoke(user.id, sub.id, ctx()),
    ]);
    const row = await prisma.subscription.findFirstOrThrow();
    const types = (await prisma.subscriptionEvent.findMany()).map((x) => x.type);
    expect(types).toContain('REVOKE');
    expect(row.revokedAt).not.toBeNull();
    expect(r.kind).toBe('ok');
    expect(e.kind === 'ok' ? types.includes('EXTEND') : !types.includes('EXTEND')).toBe(true);
  });
});
