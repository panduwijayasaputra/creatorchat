import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';
import { runSeed } from '../seed/run-seed.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

let next = 100n;
const makeUser = () =>
  prisma.user.create({ data: { telegramId: next++, displayName: 'C', role: Role.CREATOR } });

describe('creators table', () => {
  it('stores a creator with a valid public code, ACTIVE by default', async () => {
    const user = await makeUser();
    const creator = await prisma.creator.create({
      data: { userId: user.id, publicCode: 'k4m5x2qa' },
    });
    expect(creator.status).toBe('ACTIVE');
  });

  it('rejects a duplicate public_code', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await prisma.creator.create({ data: { userId: a.id, publicCode: 'k4m5x2qa' } });
    await expect(
      prisma.creator.create({ data: { userId: b.id, publicCode: 'k4m5x2qa' } }),
    ).rejects.toThrow();
  });

  it('rejects a second creator row for the same user', async () => {
    const user = await makeUser();
    await prisma.creator.create({ data: { userId: user.id, publicCode: 'aaaaaaaa' } });
    await expect(
      prisma.creator.create({ data: { userId: user.id, publicCode: 'bbbbbbbb' } }),
    ).rejects.toThrow();
  });

  it.each(['KAMAXZQA', 'abcdefg', 'abcdefghi', 'abcdef01', 'abcdef89', 'abcd-fgh', ''])(
    'rejects the malformed public_code %j (CHECK)',
    async (publicCode) => {
      const user = await makeUser();
      await expect(
        prisma.creator.create({ data: { userId: user.id, publicCode } }),
      ).rejects.toThrow();
    },
  );

  it('refuses to delete a user that has a creator (RESTRICT)', async () => {
    const user = await makeUser();
    await prisma.creator.create({ data: { userId: user.id, publicCode: 'k4m5x2qa' } });
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});

describe('seed fixtures', () => {
  it('creates one creator per CREATOR fixture and stays idempotent', async () => {
    const first = await runSeed(prisma, { adminPassword: 'a-supplied-password-1' });
    expect(first.creatorsCreated).toBe(3);
    const second = await runSeed(prisma, { adminPassword: 'a-supplied-password-1' });
    expect(second.creatorsCreated).toBe(0);
    expect(await prisma.creator.count()).toBe(3);
    const salsa = await prisma.creator.findUniqueOrThrow({ where: { publicCode: 'salsa234' } });
    expect(salsa.status).toBe('ACTIVE');
  });
});
