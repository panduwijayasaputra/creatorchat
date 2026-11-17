import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

let n = 80_000n;
const ids = { admin: '', customer: '', otherCustomer: '', creator: '', otherCreator: '' };

async function makeCreator(code: string) {
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: code, role: 'CREATOR' },
  });
  return (await prisma.creator.create({ data: { userId: owner.id, publicCode: code } })).id;
}

beforeEach(async () => {
  await resetDatabase(prisma);
  ids.admin = (
    await prisma.adminAccount.create({ data: { username: 'a.admin', passwordHash: 'x' } })
  ).id;
  ids.customer = (await prisma.user.create({ data: { telegramId: n++, displayName: 'C' } })).id;
  ids.otherCustomer = (
    await prisma.user.create({ data: { telegramId: n++, displayName: 'D' } })
  ).id;
  ids.creator = await makeCreator('abcdefgh');
  ids.otherCreator = await makeCreator('bcdefghj');
});
afterAll(() => prisma.$disconnect());

const request = (extra: Record<string, unknown> = {}) =>
  prisma.accessRequest.create({
    data: { customerId: ids.customer, creatorId: ids.creator, type: 'TRIAL', ...extra },
  });
const reviewed = (status: 'APPROVED' | 'REJECTED', extra: Record<string, unknown> = {}) =>
  request({
    status,
    reviewedAt: new Date('2026-11-16T00:00:00.000Z'),
    reviewedByAdminId: ids.admin,
    ...(status === 'REJECTED' ? { reviewReason: 'Belum memenuhi syarat.' } : {}),
    ...extra,
  });

describe('access_requests', () => {
  it('defaults to PENDING with no review fields', async () => {
    const row = await request();
    expect(row).toMatchObject({ status: 'PENDING', reviewedAt: null, reviewReason: null });
  });

  it('allows one PENDING request per customer and creator, not two', async () => {
    await request();
    await expect(request({ type: 'RENEWAL' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a pending request next to decided ones, and other pairs independently', async () => {
    await reviewed('APPROVED');
    await reviewed('REJECTED');
    await request();
    await prisma.accessRequest.create({
      data: { customerId: ids.customer, creatorId: ids.otherCreator, type: 'TRIAL' },
    });
    await prisma.accessRequest.create({
      data: { customerId: ids.otherCustomer, creatorId: ids.creator, type: 'RENEWAL' },
    });
    expect(await prisma.accessRequest.count()).toBe(5);
  });

  it('refuses a review that does not match the status', async () => {
    await expect(request({ reviewedAt: new Date() })).rejects.toThrow();
    await expect(request({ reviewReason: 'x' })).rejects.toThrow();
    await expect(
      request({ status: 'REJECTED', reviewedAt: new Date(), reviewedByAdminId: ids.admin }),
    ).rejects.toThrow(); // a rejection needs a reason
    await expect(request({ status: 'APPROVED' })).rejects.toThrow(); // and a review time
  });

  it('bounds the reason to 1–300 characters', async () => {
    await expect(reviewed('REJECTED', { reviewReason: '' })).rejects.toThrow();
    await expect(reviewed('REJECTED', { reviewReason: 'x'.repeat(301) })).rejects.toThrow();
    await expect(reviewed('REJECTED', { reviewReason: 'x'.repeat(300) })).resolves.toBeTruthy();
  });

  it('does not let a referenced customer, creator or admin be deleted', async () => {
    await reviewed('REJECTED');
    await expect(prisma.user.delete({ where: { id: ids.customer } })).rejects.toThrow();
    await expect(prisma.creator.delete({ where: { id: ids.creator } })).rejects.toThrow();
    await expect(prisma.adminAccount.delete({ where: { id: ids.admin } })).rejects.toThrow();
  });

  describe('subscription_event_id (US-024)', () => {
    async function event() {
      const sub = await prisma.subscription.create({
        data: {
          customerId: ids.customer,
          creatorId: ids.creator,
          startsAt: new Date('2026-11-17T00:00:00.000Z'),
          endsAt: new Date('2026-12-17T00:00:00.000Z'),
        },
      });
      return prisma.subscriptionEvent.create({
        data: { subscriptionId: sub.id, type: 'GRANT', adminId: ids.admin, reason: 'Disetujui.' },
      });
    }

    it('is optional on an APPROVED request and links the event', async () => {
      const e = await event();
      expect(await reviewed('APPROVED')).toMatchObject({ subscriptionEventId: null });
      await prisma.accessRequest.deleteMany();
      const linked = await reviewed('APPROVED', { subscriptionEventId: e.id });
      expect(linked.subscriptionEventId).toBe(e.id);
    });

    it('is refused on a PENDING or REJECTED request', async () => {
      const e = await event();
      await expect(request({ subscriptionEventId: e.id })).rejects.toThrow();
      await expect(reviewed('REJECTED', { subscriptionEventId: e.id })).rejects.toThrow();
    });

    it('must point at a real event', async () => {
      await expect(
        reviewed('APPROVED', { subscriptionEventId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toThrow();
    });

    it('guards a linked event against deletion', async () => {
      const e = await event();
      await reviewed('APPROVED', { subscriptionEventId: e.id });
      await expect(
        prisma.$executeRaw`DELETE FROM subscription_events WHERE id = ${e.id}::uuid`,
      ).rejects.toThrow();
    });
  });
});
