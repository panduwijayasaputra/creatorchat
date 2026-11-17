import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxService } from '../outbox/outbox.service.js';
import { AccessRequestService } from './access-request.service.js';
import { CreatorAccessService } from './creator-access.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
let now = new Date('2026-11-17T05:00:00.000Z');
const service = new AccessRequestService(prisma, new OutboxService(), () => now);
const access = new CreatorAccessService(prisma, () => now);

let n = 70_000n;
let codeNo = 0;

beforeEach(async () => {
  now = new Date('2026-11-17T05:00:00.000Z');
  codeNo = 0;
  await resetDatabase(prisma);
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

const sub = (
  customerId: string,
  creatorId: string,
  startsAt: Date,
  endsAt: Date,
  revokedAt?: Date,
) =>
  prisma.subscription.create({
    data: { customerId, creatorId, startsAt, endsAt, revokedAt: revokedAt ?? null },
  });
const ms = (d: number) => new Date(now.getTime() + d);
const DAY = 86_400_000;

const counts = async () => ({
  requests: await prisma.accessRequest.count(),
  audit: await prisma.auditLog.count(),
  outbox: await prisma.outboxEvent.count(),
});

async function setup() {
  return { user: await makeUser(), creator: await makeCreator() };
}

describe('AccessRequestService.submit', () => {
  it('guest → TRIAL created, with audit and one outbox event of ids only', async () => {
    const { user, creator } = await setup();
    const r = await service.submit(user.id, creator.publicCode);
    expect(r).toMatchObject({ kind: 'created', type: 'TRIAL', requestedAt: now });
    expect(await counts()).toEqual({ requests: 1, audit: 1, outbox: 1 });
    const row = await prisma.accessRequest.findFirstOrThrow();
    expect(row).toMatchObject({ customerId: user.id, creatorId: creator.id, status: 'PENDING' });
    const event = await prisma.outboxEvent.findFirstOrThrow();
    expect(event.type).toBe('access_request.created');
    expect(event.payload).toEqual({
      access_request_id: row.id,
      creator_id: creator.id,
      customer_id: user.id,
      type: 'TRIAL',
    });
  });

  it('expired and revoked → RENEWAL', async () => {
    const a = await setup();
    await sub(a.user.id, a.creator.id, ms(-30 * DAY), ms(-1000));
    expect(await service.submit(a.user.id, a.creator.publicCode)).toMatchObject({
      kind: 'created',
      type: 'RENEWAL',
    });
    const b = await setup();
    await sub(b.user.id, b.creator.id, ms(-DAY), ms(30 * DAY), ms(-1000));
    expect(await service.submit(b.user.id, b.creator.publicCode)).toMatchObject({
      kind: 'created',
      type: 'RENEWAL',
    });
  });

  it('active → already_active, nothing written; the boundary is exact', async () => {
    const { user, creator } = await setup();
    await sub(user.id, creator.id, ms(-DAY), ms(1000));
    expect(await service.submit(user.id, creator.publicCode)).toEqual({ kind: 'already_active' });
    expect(await counts()).toEqual({ requests: 0, audit: 0, outbox: 0 });
    now = ms(1000); // ends_at == now → ended
    expect(await service.submit(user.id, creator.publicCode)).toMatchObject({
      kind: 'created',
      type: 'RENEWAL',
    });
  });

  it('a repeat returns the existing request and writes nothing more', async () => {
    const { user, creator } = await setup();
    await service.submit(user.id, creator.publicCode);
    const first = await prisma.accessRequest.findFirstOrThrow();
    now = ms(60_000);
    const again = await service.submit(user.id, creator.publicCode);
    expect(again).toMatchObject({ kind: 'existing', type: 'TRIAL', requestedAt: first.createdAt });
    expect(await counts()).toEqual({ requests: 1, audit: 1, outbox: 1 });
  });

  it('two parallel submits leave one row and one event', async () => {
    const { user, creator } = await setup();
    const results = await Promise.all([
      service.submit(user.id, creator.publicCode),
      service.submit(user.id, creator.publicCode),
      service.submit(user.id, creator.publicCode),
    ]);
    expect(results.filter((r) => r.kind === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'existing')).toHaveLength(2);
    expect(await counts()).toEqual({ requests: 1, audit: 1, outbox: 1 });
  });

  it('after a rejection a new PENDING row is added and the history is kept', async () => {
    const { user, creator } = await setup();
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia', passwordHash: 'x' },
    });
    await prisma.accessRequest.create({
      data: {
        customerId: user.id,
        creatorId: creator.id,
        type: 'TRIAL',
        status: 'REJECTED',
        reviewedAt: ms(-DAY),
        reviewedByAdminId: admin.id,
        reviewReason: 'Belum bisa.',
      },
    });
    expect(await service.submit(user.id, creator.publicCode)).toMatchObject({
      kind: 'created',
      type: 'TRIAL',
    });
    expect(await prisma.accessRequest.count()).toBe(2);
  });

  it('a grant racing a submit never leaves an active customer with a new pending row', async () => {
    const { user, creator } = await setup();
    const grant = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await new Promise((r) => setTimeout(r, 150));
      await tx.subscription.create({
        data: { customerId: user.id, creatorId: creator.id, startsAt: ms(-1000), endsAt: ms(DAY) },
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    const [, result] = await Promise.all([grant, service.submit(user.id, creator.publicCode)]);
    expect(result).toEqual({ kind: 'already_active' });
    expect(await prisma.accessRequest.count()).toBe(0);
  });

  it('unknown, malformed, blocked creator → not_found, nothing written', async () => {
    const { user } = await setup();
    const blocked = await makeCreator('BLOCKED');
    const blockedAccount = await makeCreator();
    await prisma.user.update({ where: { id: blockedAccount.userId }, data: { status: 'BLOCKED' } });
    for (const code of ['zzzzzzzz', 'nope', '', blocked.publicCode, blockedAccount.publicCode]) {
      expect(await service.submit(user.id, code), code).toEqual({ kind: 'not_found' });
    }
    expect(await counts()).toEqual({ requests: 0, audit: 0, outbox: 0 });
  });

  it('a blocked customer or a creator is not_eligible', async () => {
    const { user, creator } = await setup();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
    expect(await service.submit(user.id, creator.publicCode)).toEqual({ kind: 'not_eligible' });
    expect(await service.submit(creator.userId, creator.publicCode)).toEqual({
      kind: 'not_eligible',
    });
    expect(await counts()).toEqual({ requests: 0, audit: 0, outbox: 0 });
  });

  it("another customer's pending request does not affect me", async () => {
    const { user, creator } = await setup();
    const other = await makeUser();
    await service.submit(other.id, creator.publicCode);
    expect(await service.submit(user.id, creator.publicCode)).toMatchObject({ kind: 'created' });
    expect(await prisma.accessRequest.count()).toBe(2);
  });
});

describe('CreatorAccessService.profile lastReview', () => {
  it("is the viewer's latest reviewed request only, never pending, no reason", async () => {
    const { user, creator } = await setup();
    const other = await makeUser();
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia', passwordHash: 'x' },
    });
    const review = (customerId: string, status: 'APPROVED' | 'REJECTED', at: Date) =>
      prisma.accessRequest.create({
        data: {
          customerId,
          creatorId: creator.id,
          type: 'TRIAL',
          status,
          reviewedAt: at,
          reviewedByAdminId: admin.id,
          reviewReason: status === 'REJECTED' ? 'Alasan.' : null,
        },
      });
    const profile = () => access.profile(user.id, creator.publicCode);

    let p = await profile();
    expect(p).toMatchObject({ kind: 'ok', lastReview: null });

    await review(other.id, 'APPROVED', ms(-1000)); // someone else's
    p = await profile();
    expect(p).toMatchObject({ lastReview: null });

    await review(user.id, 'REJECTED', ms(-2 * DAY));
    await review(user.id, 'APPROVED', ms(-DAY));
    p = await profile();
    expect(p).toMatchObject({ lastReview: { status: 'APPROVED', reviewedAt: ms(-DAY) } });
    expect(JSON.stringify(p)).not.toContain('Alasan');

    await service.submit(user.id, creator.publicCode); // pending must not shadow the review
    p = await profile();
    expect(p).toMatchObject({
      access: { state: 'PENDING' },
      lastReview: { status: 'APPROVED' },
    });
  });
});
