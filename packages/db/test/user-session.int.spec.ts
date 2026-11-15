import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const expiresAt = () => new Date(Date.now() + 3600_000);

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('user sessions (no refresh token)', () => {
  it('stores a user session with a session_version and no refresh hash, many times over', async () => {
    const user = await prisma.user.create({ data: { telegramId: 7n, displayName: 'U' } });
    for (let i = 0; i < 3; i++) {
      await prisma.session.create({
        data: { userId: user.id, sessionVersion: user.sessionVersion, expiresAt: expiresAt() },
      });
    }
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(3);
  });

  it('rejects a user session without a session_version', async () => {
    const user = await prisma.user.create({ data: { telegramId: 8n, displayName: 'U' } });
    await expect(
      prisma.session.create({ data: { userId: user.id, expiresAt: expiresAt() } }),
    ).rejects.toThrow();
  });

  it('still requires a refresh hash for admin sessions', async () => {
    const admin = await prisma.adminAccount.create({ data: { username: 'a', passwordHash: 'h' } });
    await expect(
      prisma.session.create({ data: { adminId: admin.id, expiresAt: expiresAt() } }),
    ).rejects.toThrow();
    await expect(
      prisma.session.create({
        data: { adminId: admin.id, refreshTokenHash: 'x', expiresAt: expiresAt() },
      }),
    ).resolves.toBeTruthy();
  });

  it('still rejects a session with neither principal, or with both', async () => {
    const user = await prisma.user.create({ data: { telegramId: 9n, displayName: 'U' } });
    const admin = await prisma.adminAccount.create({ data: { username: 'b', passwordHash: 'h' } });
    await expect(
      prisma.session.create({ data: { sessionVersion: 1, expiresAt: expiresAt() } }),
    ).rejects.toThrow();
    await expect(
      prisma.session.create({
        data: {
          userId: user.id,
          adminId: admin.id,
          sessionVersion: 1,
          refreshTokenHash: 'y',
          expiresAt: expiresAt(),
        },
      }),
    ).rejects.toThrow();
  });
});
