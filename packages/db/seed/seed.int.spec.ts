import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, type PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';
import { verifyPassword } from './admin.js';
import { USER_FIXTURES } from './fixtures.js';
import { runSeed } from './run-seed.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seed', () => {
  it('creates one admin and the six fixture users, and is idempotent', async () => {
    const first = await runSeed(prisma, { adminPassword: 'a-supplied-password-1' });
    expect(first).toMatchObject({ adminCreated: true, usersCreated: 6, usersExisting: 0 });

    const hashBefore = (
      await prisma.adminAccount.findUniqueOrThrow({ where: { username: 'admin' } })
    ).passwordHash;

    const second = await runSeed(prisma, { adminPassword: 'a-different-password-2' });
    expect(second).toMatchObject({ adminCreated: false, usersCreated: 0, usersExisting: 6 });

    expect(await prisma.adminAccount.count()).toBe(1);
    expect(await prisma.user.count()).toBe(6);
    const hashAfter = (
      await prisma.adminAccount.findUniqueOrThrow({ where: { username: 'admin' } })
    ).passwordHash;
    expect(hashAfter).toBe(hashBefore);
  });

  it('stores a verifiable Argon2id hash, never the supplied password', async () => {
    await runSeed(prisma, { adminPassword: 'a-supplied-password-1' });
    const admin = await prisma.adminAccount.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin.passwordHash).not.toContain('a-supplied-password-1');
    expect(await verifyPassword(admin.passwordHash, 'a-supplied-password-1')).toBe(true);
    expect(await verifyPassword(admin.passwordHash, 'wrong')).toBe(false);
  });

  it('generates a 24-character password when none is supplied and returns it once', async () => {
    const result = await runSeed(prisma);
    expect(result.generatedPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const admin = await prisma.adminAccount.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(await verifyPassword(admin.passwordHash, result.generatedPassword as string)).toBe(true);

    const again = await runSeed(prisma);
    expect(again.generatedPassword).toBeUndefined();
  });

  it('does not report a generated password when one was supplied', async () => {
    const result = await runSeed(prisma, { adminPassword: 'supplied-password-xyz' });
    expect(result.generatedPassword).toBeUndefined();
  });

  it('normalizes the admin username to lowercase and rejects invalid ones', async () => {
    await runSeed(prisma, { adminUsername: 'Root.Admin', adminPassword: 'pw-pw-pw-pw-1' });
    expect(await prisma.adminAccount.count({ where: { username: 'root.admin' } })).toBe(1);
    await expect(runSeed(prisma, { adminUsername: 'x' })).rejects.toThrow(/Admin username/);
  });

  it('seeds fixtures with the intended roles, ACTIVE status and reserved Telegram IDs', async () => {
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const users = await prisma.user.findMany({ orderBy: { telegramId: 'asc' } });
    expect(users).toHaveLength(USER_FIXTURES.length);
    expect(users.filter((u) => u.role === Role.CREATOR).map((u) => u.displayName)).toEqual([
      'Salsa',
      'Kirana',
      'Dinda',
    ]);
    expect(users.every((u) => u.status === 'ACTIVE')).toBe(true);
    expect(
      users.every((u) => u.telegramId >= 9_000_000_000n && u.telegramId < 9_000_001_000n),
    ).toBe(true);
  });

  it('does not alter an existing fixture user on re-run', async () => {
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    await prisma.user.update({
      where: { telegramId: 9_000_000_011n },
      data: { sessionVersion: 5, displayName: 'Edited' },
    });
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const maya = await prisma.user.findUniqueOrThrow({ where: { telegramId: 9_000_000_011n } });
    expect(maya.sessionVersion).toBe(5);
    expect(maya.displayName).toBe('Edited');
  });

  it('gives Raka Putra one active subscription to Salsa, once', async () => {
    const first = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(first.subscriptionsCreated).toBe(1);
    const second = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(second.subscriptionsCreated).toBe(0);
    const rows = await prisma.subscription.findMany({
      include: { customer: true, creator: { include: { user: true } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customer.displayName).toBe('Raka Putra');
    expect(rows[0]?.creator.user.displayName).toBe('Salsa');
    expect(rows[0]?.endsAt.toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(rows[0]?.revokedAt).toBeNull();
  });
});
