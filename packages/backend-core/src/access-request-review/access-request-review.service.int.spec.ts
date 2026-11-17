import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HistoryQuerySchema } from '@creatorchat/contracts';
import { AccessRequestService } from '../creator-access/access-request.service.js';
import { CreatorAccessService } from '../creator-access/creator-access.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SubscriptionAccessService } from '../subscription-access/subscription-access.service.js';
import { UserHistoryService } from '../user-detail/user-history.service.js';
import { AccessRequestReviewService } from './access-request-review.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-17T05:00:00.000Z');
const outbox = new OutboxService();
const review = new AccessRequestReviewService(prisma, outbox, () => now);
const access = new SubscriptionAccessService(prisma, outbox, () => now);
const submit = new AccessRequestService(prisma, outbox, () => now);
const profiles = new CreatorAccessService(prisma, () => now);

let n = 90_000n;
let codeNo = 0;
let adminId = '';
let otherAdminId = '';
const ctx = (id = adminId) => ({ adminId: id, requestId: 'req-1' });
const DAY = 86_400_000;

beforeEach(async () => {
  now = new Date('2026-11-17T05:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
  adminId = (await prisma.adminAccount.create({ data: { username: 'nadia', passwordHash: 'x' } }))
    .id;
  otherAdminId = (
    await prisma.adminAccount.create({ data: { username: 'bima', passwordHash: 'x' } })
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
const grant = (userId: string, creatorId: string, accessRequestId?: string) =>
  access.grant(
    userId,
    { creatorId, durationDays: 30, accessRequestId },
    { adminId, reason: 'Disetujui.' },
  );

async function pendingRequest() {
  const user = await makeUser();
  const creator = await makeCreator();
  const r = await submit.submit(user.id, creator.publicCode);
  if (r.kind !== 'created') throw new Error(r.kind);
  const row = await prisma.accessRequest.findFirstOrThrow({
    where: { customerId: user.id, creatorId: creator.id },
  });
  return { user, creator, row };
}

const snapshot = async () => ({
  requests: await prisma.accessRequest.findMany({ orderBy: { id: 'asc' } }),
  audit: await prisma.auditLog.count(),
  outbox: await prisma.outboxEvent.count(),
  subs: await prisma.subscription.count(),
});

describe('listPending', () => {
  it('lists only this user’s pending requests, oldest first, with the creator name', async () => {
    const { user, creator } = await pendingRequest();
    const second = await makeCreator();
    now = new Date(now.getTime() + 60_000);
    await submit.submit(user.id, second.publicCode);
    const other = await makeUser();
    await submit.submit(other.id, creator.publicCode);
    const out = await review.listPending(user.id);
    if (out.kind !== 'ok') throw new Error(out.kind);
    expect(out.items.map((i) => i.creator.id)).toEqual([creator.id, second.id]);
    expect(out.items[0]).toMatchObject({ type: 'TRIAL', creator: { displayName: 'Creator 0' } });
    expect(JSON.stringify(out)).not.toContain(other.id);
  });

  it('excludes decided requests; creator, admin, malformed and unknown ids are not_found', async () => {
    const { user, creator, row } = await pendingRequest();
    await review.reject(user.id, row.id, { reason: 'Belum.' }, ctx());
    expect(await review.listPending(user.id)).toEqual({ kind: 'ok', items: [] });
    for (const id of [creator.userId, adminId, 'nope', '00000000-0000-4000-8000-000000000000']) {
      expect(await review.listPending(id), id).toEqual({ kind: 'not_found' });
    }
  });
});

describe('reject', () => {
  it('rejects with reason, admin and time; audit has the reason, the outbox only ids', async () => {
    const { user, creator, row } = await pendingRequest();
    const before = await snapshot();
    const out = await review.reject(user.id, row.id, { reason: 'Belum memenuhi syarat.' }, ctx());
    expect(out).toEqual({ kind: 'ok', requestId: row.id });
    const after = await prisma.accessRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({
      status: 'REJECTED',
      reviewedByAdminId: adminId,
      reviewedAt: now,
      reviewReason: 'Belum memenuhi syarat.',
      subscriptionEventId: null,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'access.request.rejected' },
    });
    expect(audit).toMatchObject({
      actorType: 'ADMIN',
      actorId: adminId,
      targetType: 'access_request',
      targetId: row.id,
      reason: 'Belum memenuhi syarat.',
    });
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { type: 'access_request.rejected' },
    });
    expect(event.payload).toEqual({
      access_request_id: row.id,
      creator_id: creator.id,
      customer_id: user.id,
      type: 'TRIAL',
    });
    expect(JSON.stringify(event.payload)).not.toContain('syarat');
    expect(await prisma.outboxEvent.count()).toBe(before.outbox + 1);
    // The customer now sees the rejected card and can ask again.
    const p = await profiles.profile(user.id, creator.publicCode);
    expect(p).toMatchObject({
      kind: 'ok',
      access: { state: 'GUEST' },
      lastReview: { status: 'REJECTED' },
    });
    expect(await submit.submit(user.id, creator.publicCode)).toMatchObject({ kind: 'created' });
    expect(await prisma.accessRequest.count()).toBe(2);
  });

  it('a second reject and a reject after approval are already_reviewed and change nothing', async () => {
    const a = await pendingRequest();
    await review.reject(a.user.id, a.row.id, { reason: 'Belum.' }, ctx());
    const before = await snapshot();
    expect(
      await review.reject(a.user.id, a.row.id, { reason: 'Lagi.' }, ctx(otherAdminId)),
    ).toEqual({
      kind: 'already_reviewed',
      status: 'REJECTED',
    });
    expect(await snapshot()).toEqual(before);

    const b = await pendingRequest();
    const g = await grant(b.user.id, b.creator.id, b.row.id);
    expect(g.kind).toBe('ok');
    const mid = await snapshot();
    expect(await review.reject(b.user.id, b.row.id, { reason: 'Telat.' }, ctx())).toEqual({
      kind: 'already_reviewed',
      status: 'APPROVED',
    });
    expect(await snapshot()).toEqual(mid);
  });

  it('is not_found for another customer’s request, a creator id and bad ids; nothing changes', async () => {
    const a = await pendingRequest();
    const stranger = await makeUser();
    const before = await snapshot();
    for (const [userId, requestId] of [
      [stranger.id, a.row.id],
      [a.creator.userId, a.row.id],
      [a.user.id, 'nope'],
      [a.user.id, '00000000-0000-4000-8000-000000000000'],
    ] as const) {
      expect(await review.reject(userId, requestId, { reason: 'x' }, ctx())).toEqual({
        kind: 'not_found',
      });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('can reject a blocked customer’s request', async () => {
    const a = await pendingRequest();
    await prisma.user.update({ where: { id: a.user.id }, data: { status: 'BLOCKED' } });
    expect((await review.reject(a.user.id, a.row.id, { reason: 'x' }, ctx())).kind).toBe('ok');
  });

  it('parallel double submit acts once', async () => {
    const a = await pendingRequest();
    const results = await Promise.all([
      review.reject(a.user.id, a.row.id, { reason: 'Satu.' }, ctx()),
      review.reject(a.user.id, a.row.id, { reason: 'Dua.' }, ctx(otherAdminId)),
      review.reject(a.user.id, a.row.id, { reason: 'Tiga.' }, ctx()),
    ]);
    expect(results.filter((r) => r.kind === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'already_reviewed')).toHaveLength(2);
    expect(await prisma.outboxEvent.count({ where: { type: 'access_request.rejected' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'access.request.rejected' } })).toBe(1);
  });
});

describe('grant and extend close the pending request', () => {
  it('approve: grant with the request id links the event and writes one approval audit', async () => {
    const a = await pendingRequest();
    const out = await grant(a.user.id, a.creator.id, a.row.id);
    expect(out.kind).toBe('ok');
    const row = await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } });
    const event = await prisma.subscriptionEvent.findFirstOrThrow({ where: { type: 'GRANT' } });
    expect(row).toMatchObject({
      status: 'APPROVED',
      reviewedByAdminId: adminId,
      reviewedAt: now,
      subscriptionEventId: event.id,
      reviewReason: null,
    });
    const audits = await prisma.auditLog.findMany({ where: { action: 'access.request.approved' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetId: a.row.id,
      changes: { subscription_event_id: event.id, via: 'request' },
    });
    const p = await profiles.profile(a.user.id, a.creator.publicCode);
    expect(p).toMatchObject({ access: { state: 'ACTIVE' }, lastReview: { status: 'APPROVED' } });
  });

  it('a renewal re-grants from now', async () => {
    const user = await makeUser();
    const creator = await makeCreator();
    await prisma.subscription.create({
      data: {
        customerId: user.id,
        creatorId: creator.id,
        startsAt: new Date(now.getTime() - 40 * DAY),
        endsAt: new Date(now.getTime() - 10 * DAY),
      },
    });
    const sub = await submit.submit(user.id, creator.publicCode);
    expect(sub).toMatchObject({ kind: 'created', type: 'RENEWAL' });
    const row = await prisma.accessRequest.findFirstOrThrow();
    const out = await grant(user.id, creator.id, row.id);
    if (out.kind !== 'ok') throw new Error(out.kind);
    expect(out.subscription.startsAt).toEqual(now);
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'APPROVED',
    );
  });

  it('a direct grant (no request id) closes the same pair’s pending request, others untouched', async () => {
    const a = await pendingRequest();
    const otherCreator = await makeCreator();
    await submit.submit(a.user.id, otherCreator.publicCode);
    await grant(a.user.id, a.creator.id);
    const status = async (customerId: string, creatorId: string) =>
      (await prisma.accessRequest.findFirstOrThrow({ where: { customerId, creatorId } })).status;
    expect(await status(a.user.id, a.creator.id)).toBe('APPROVED');
    expect(await status(a.user.id, otherCreator.id)).toBe('PENDING');
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: 'access.request.approved' } }),
    ).toMatchObject({ changes: { via: 'direct' } });
  });

  it('without a pending request nothing extra is written', async () => {
    const user = await makeUser();
    const creator = await makeCreator();
    await grant(user.id, creator.id);
    expect(await prisma.auditLog.count({ where: { action: 'access.request.approved' } })).toBe(0);
  });

  it('extending an expired access closes a waiting renewal request; extending a running one has none', async () => {
    const user = await makeUser();
    const creator = await makeCreator();
    const subscription = await prisma.subscription.create({
      data: {
        customerId: user.id,
        creatorId: creator.id,
        startsAt: new Date(now.getTime() - 40 * DAY),
        endsAt: new Date(now.getTime() - 1000),
      },
    });
    await submit.submit(user.id, creator.publicCode);
    const out = await access.extend(
      user.id,
      subscription.id,
      { durationDays: 30 },
      { adminId, reason: 'Perpanjang.' },
    );
    expect(out.kind).toBe('ok');
    const row = await prisma.accessRequest.findFirstOrThrow();
    expect(row.status).toBe('APPROVED');
    expect(row.subscriptionEventId).not.toBeNull();
  });

  it('refuses a request id of another customer or creator (not_found) and a reviewed one (request_reviewed)', async () => {
    const a = await pendingRequest();
    const stranger = await makeUser();
    const otherCreator = await makeCreator();
    const before = await snapshot();
    expect(await grant(stranger.id, a.creator.id, a.row.id)).toEqual({ kind: 'not_found' });
    expect(await grant(a.user.id, otherCreator.id, a.row.id)).toEqual({ kind: 'not_found' });
    expect(await grant(a.user.id, a.creator.id, 'nope')).toEqual({ kind: 'not_found' });
    expect(await snapshot()).toEqual(before);

    await review.reject(a.user.id, a.row.id, { reason: 'Belum.' }, ctx());
    const mid = await snapshot();
    expect(await grant(a.user.id, a.creator.id, a.row.id)).toEqual({
      kind: 'request_reviewed',
      status: 'REJECTED',
    });
    expect(await snapshot()).toEqual(mid);
  });

  it('a blocked creator or customer still refuses the grant and leaves the request pending', async () => {
    const a = await pendingRequest();
    await prisma.creator.update({ where: { id: a.creator.id }, data: { status: 'BLOCKED' } });
    expect((await grant(a.user.id, a.creator.id, a.row.id)).kind).toBe('creator_not_active');
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } })).status).toBe(
      'PENDING',
    );
  });

  it('grant-with-request racing a reject: exactly one wins, no deadlock (20 rounds)', async () => {
    for (let i = 0; i < 20; i++) {
      await resetDatabase(prisma);
      codeNo = 0;
      adminId = (
        await prisma.adminAccount.create({ data: { username: `nadia${i}`, passwordHash: 'x' } })
      ).id;
      const a = await pendingRequest();
      const [g, r] = await Promise.all([
        grant(a.user.id, a.creator.id, a.row.id),
        review.reject(a.user.id, a.row.id, { reason: 'Belum.' }, ctx()),
      ]);
      const status = (await prisma.accessRequest.findUniqueOrThrow({ where: { id: a.row.id } }))
        .status;
      if (g.kind === 'ok') {
        expect(r).toEqual({ kind: 'already_reviewed', status: 'APPROVED' });
        expect(status).toBe('APPROVED');
        expect(await prisma.subscription.count()).toBe(1);
      } else {
        expect(g).toEqual({ kind: 'request_reviewed', status: 'REJECTED' });
        expect(r.kind).toBe('ok');
        expect(status).toBe('REJECTED');
        expect(await prisma.subscription.count()).toBe(0);
      }
    }
  });
});

describe('History', () => {
  it('lists the created, approved and rejected rows with fixed labels and no reason', async () => {
    const a = await pendingRequest();
    const b = await pendingRequest();
    await prisma.accessRequest.update({
      where: { id: b.row.id },
      data: { customerId: a.user.id, creatorId: b.creator.id },
    });
    await grant(a.user.id, a.creator.id, a.row.id);
    await review.reject(a.user.id, b.row.id, { reason: 'Rahasia admin' }, ctx());
    const history = new UserHistoryService(prisma);
    const out = await history.list(a.user.id, HistoryQuerySchema.parse({ page_size: '50' }));
    const labels = out?.items.map((i) => i.action) ?? [];
    expect(labels).toEqual(expect.arrayContaining(['Minta akses', 'Setujui akses', 'Tolak akses']));
    expect(JSON.stringify(out)).not.toContain('Rahasia');
  });
});
