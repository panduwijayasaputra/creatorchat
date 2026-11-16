import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

let next = 500n;
const makeUser = (role: Role = Role.USER) =>
  prisma.user.create({ data: { telegramId: next++, displayName: 'U', role } });

const application = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  creatorName: 'Maya',
  instagramUrl: 'https://instagram.com/maya',
  creatorType: 'HUMAN' as const,
  description: 'Resep',
  ...extra,
});

describe('creator_applications', () => {
  it('defaults to PENDING with no review fields', async () => {
    const user = await makeUser();
    const row = await prisma.creatorApplication.create({ data: application(user.id) });
    expect(row.status).toBe('PENDING');
    expect(row.reviewedAt).toBeNull();
    expect(row.reviewReason).toBeNull();
  });

  it('rejects a second PENDING request for the same user', async () => {
    const user = await makeUser();
    await prisma.creatorApplication.create({ data: application(user.id) });
    await expect(
      prisma.creatorApplication.create({ data: application(user.id) }),
    ).rejects.toThrow();
  });

  it('allows PENDING again after REJECTED or APPROVED, and PENDING for another user', async () => {
    const user = await makeUser();
    const other = await makeUser();
    await prisma.creatorApplication.create({
      data: application(user.id, {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewReason: 'Link tidak valid',
      }),
    });
    await prisma.creatorApplication.create({
      data: application(user.id, { status: 'APPROVED', reviewedAt: new Date() }),
    });
    await prisma.creatorApplication.create({ data: application(user.id) });
    await prisma.creatorApplication.create({ data: application(other.id) });
    expect(await prisma.creatorApplication.count({ where: { userId: user.id } })).toBe(3);
  });

  it('rejects review data on a PENDING row, and a REJECTED row without a reason or time', async () => {
    const user = await makeUser();
    await expect(
      prisma.creatorApplication.create({
        data: application(user.id, { reviewReason: 'x' }),
      }),
    ).rejects.toThrow();
    await expect(
      prisma.creatorApplication.create({
        data: application(user.id, { status: 'REJECTED', reviewedAt: new Date() }),
      }),
    ).rejects.toThrow();
    await expect(
      prisma.creatorApplication.create({
        data: application(user.id, { status: 'REJECTED', reviewReason: 'x' }),
      }),
    ).rejects.toThrow();
  });

  it('cannot delete a user that has requests (RESTRICT)', async () => {
    const user = await makeUser();
    await prisma.creatorApplication.create({ data: application(user.id) });
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});

describe('subscriptions', () => {
  const makeCreator = async (code: string) => {
    const user = await makeUser(Role.CREATOR);
    return prisma.creator.create({ data: { userId: user.id, publicCode: code } });
  };
  const period = {
    startsAt: new Date('2026-11-01T00:00:00Z'),
    endsAt: new Date('2026-11-27T00:00:00Z'),
  };

  it('stores one subscription per customer and creator', async () => {
    const customer = await makeUser();
    const creator = await makeCreator('aaaaaaaa');
    const data = { customerId: customer.id, creatorId: creator.id, ...period };
    await prisma.subscription.create({ data });
    await expect(prisma.subscription.create({ data })).rejects.toThrow();
    const other = await makeCreator('bbbbbbbb');
    await prisma.subscription.create({ data: { ...data, creatorId: other.id } });
  });

  it('requires ends_at after starts_at', async () => {
    const customer = await makeUser();
    const creator = await makeCreator('aaaaaaaa');
    await expect(
      prisma.subscription.create({
        data: {
          customerId: customer.id,
          creatorId: creator.id,
          startsAt: period.endsAt,
          endsAt: period.startsAt,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.subscription.create({
        data: {
          customerId: customer.id,
          creatorId: creator.id,
          startsAt: period.startsAt,
          endsAt: period.startsAt,
        },
      }),
    ).rejects.toThrow();
  });
});
