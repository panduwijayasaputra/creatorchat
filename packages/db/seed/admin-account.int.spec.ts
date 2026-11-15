import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { verifyPassword } from '../src/admin-password.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';
import { AdminAccountError, createOrResetAdmin } from './admin-account.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('createOrResetAdmin', () => {
  it('creates an admin with a supplied password stored only as an Argon2id hash', async () => {
    const result = await createOrResetAdmin(prisma, {
      username: 'Nadia.Admin',
      password: 'a-long-supplied-password',
    });
    expect(result).toEqual({ username: 'nadia.admin', action: 'created' });
    const admin = await prisma.adminAccount.findUniqueOrThrow({
      where: { username: 'nadia.admin' },
    });
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin.passwordHash).not.toContain('a-long-supplied-password');
    expect(admin.status).toBe('ACTIVE');
    expect(await verifyPassword(admin.passwordHash, 'a-long-supplied-password')).toBe(true);
  });

  it('generates a 24-character password once when none is supplied', async () => {
    const result = await createOrResetAdmin(prisma, { username: 'first.admin' });
    expect(result.generatedPassword).toHaveLength(24);
    const admin = await prisma.adminAccount.findUniqueOrThrow({
      where: { username: 'first.admin' },
    });
    expect(await verifyPassword(admin.passwordHash, result.generatedPassword as string)).toBe(true);
  });

  it('rejects a duplicate username without changing the existing account', async () => {
    await createOrResetAdmin(prisma, { username: 'dup.admin', password: 'first-password-123' });
    const before = await prisma.adminAccount.findUniqueOrThrow({
      where: { username: 'dup.admin' },
    });
    await expect(
      createOrResetAdmin(prisma, { username: 'dup.admin', password: 'other-password-456' }),
    ).rejects.toBeInstanceOf(AdminAccountError);
    const after = await prisma.adminAccount.findUniqueOrThrow({ where: { username: 'dup.admin' } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('rejects invalid usernames and short supplied passwords', async () => {
    await expect(createOrResetAdmin(prisma, { username: 'x' })).rejects.toThrow(/Admin username/);
    await expect(createOrResetAdmin(prisma, { username: 'bad name!' })).rejects.toThrow();
    await expect(
      createOrResetAdmin(prisma, { username: 'ok.admin', password: 'short' }),
    ).rejects.toThrow(/at least 12/);
    expect(await prisma.adminAccount.count()).toBe(0);
  });

  it('resets the password, revokes every open session and writes an audit row', async () => {
    await createOrResetAdmin(prisma, { username: 'reset.admin', password: 'old-password-123456' });
    const admin = await prisma.adminAccount.findUniqueOrThrow({
      where: { username: 'reset.admin' },
    });
    await prisma.session.createMany({
      data: [
        { adminId: admin.id, refreshTokenHash: 'h1', expiresAt: new Date(Date.now() + 1e7) },
        { adminId: admin.id, refreshTokenHash: 'h2', expiresAt: new Date(Date.now() + 1e7) },
      ],
    });

    const result = await createOrResetAdmin(prisma, {
      username: 'reset.admin',
      password: 'new-password-123456',
      resetPassword: true,
    });
    expect(result.action).toBe('reset');
    const updated = await prisma.adminAccount.findUniqueOrThrow({ where: { id: admin.id } });
    expect(await verifyPassword(updated.passwordHash, 'new-password-123456')).toBe(true);
    expect(await verifyPassword(updated.passwordHash, 'old-password-123456')).toBe(false);
    expect(await prisma.session.count({ where: { adminId: admin.id, revokedAt: null } })).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { action: 'admin.password.reset' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('new-password');
  });

  it('refuses to reset an admin that does not exist', async () => {
    await expect(
      createOrResetAdmin(prisma, { username: 'ghost.admin', resetPassword: true }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe('sessions rotation columns', () => {
  it('stores a previous hash that is unique and nullable', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'rot.admin', passwordHash: 'x' },
    });
    const expiresAt = new Date(Date.now() + 1e7);
    await prisma.session.create({ data: { adminId: admin.id, refreshTokenHash: 'a', expiresAt } });
    const rotated = await prisma.session.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: 'b',
        previousRefreshTokenHash: 'old',
        rotatedAt: new Date(),
        expiresAt,
      },
    });
    expect(rotated.previousRefreshTokenHash).toBe('old');
    await expect(
      prisma.session.create({
        data: {
          adminId: admin.id,
          refreshTokenHash: 'c',
          previousRefreshTokenHash: 'old',
          expiresAt,
        },
      }),
    ).rejects.toThrow();
  });
});
