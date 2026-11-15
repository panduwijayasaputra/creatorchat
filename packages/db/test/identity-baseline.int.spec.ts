import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, Role, type PrismaClient } from '../src/index.js';
import { createTestPrisma, loadRootEnv, resetDatabase } from '../src/testing/index.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();

const day = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + day);

async function newUser(telegramId: bigint = 1001n) {
  return prisma.user.create({ data: { telegramId, displayName: 'Tester' } });
}

async function newAdmin(username = 'admin') {
  return prisma.adminAccount.create({ data: { username, passwordHash: 'hash' } });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('identity baseline: users', () => {
  it('defaults new users to USER / ACTIVE with session_version 1 and a UUID id', async () => {
    const user = await newUser();
    expect(user.role).toBe(Role.USER);
    expect(user.status).toBe(AccountStatus.ACTIVE);
    expect(user.sessionVersion).toBe(1);
    expect(user.timezone).toBe('Asia/Jakarta');
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('rejects a duplicate telegram_id', async () => {
    await newUser(42n);
    await expect(newUser(42n)).rejects.toThrow();
  });

  it('stores telegram_id beyond Number.MAX_SAFE_INTEGER exactly', async () => {
    const big = 9_007_199_254_740_993n;
    await newUser(big);
    const found = await prisma.user.findUniqueOrThrow({ where: { telegramId: big } });
    expect(found.telegramId).toBe(big);
  });

  it('stores timestamps as timestamptz', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'created_at'`;
    expect(rows[0]?.data_type).toBe('timestamp with time zone');
  });
});

describe('identity baseline: admin accounts', () => {
  it('rejects uppercase usernames (stored lowercase)', async () => {
    await expect(newAdmin('Admin')).rejects.toThrow();
  });

  it('rejects duplicate usernames', async () => {
    await newAdmin('root');
    await expect(newAdmin('root')).rejects.toThrow();
  });
});

describe('identity baseline: sessions', () => {
  it('accepts a session owned by exactly one user', async () => {
    const user = await newUser();
    const s = await prisma.session.create({
      data: { userId: user.id, sessionVersion: 1, refreshTokenHash: 'h1', expiresAt: future() },
    });
    expect(s.adminId).toBeNull();
  });

  it('accepts a session owned by exactly one admin', async () => {
    const admin = await newAdmin();
    const s = await prisma.session.create({
      data: { adminId: admin.id, refreshTokenHash: 'h2', expiresAt: future() },
    });
    expect(s.userId).toBeNull();
  });

  it('rejects a session owned by both a user and an admin', async () => {
    const user = await newUser();
    const admin = await newAdmin();
    await expect(
      prisma.session.create({
        data: { userId: user.id, adminId: admin.id, refreshTokenHash: 'h3', expiresAt: future() },
      }),
    ).rejects.toThrow();
  });

  it('rejects a session owned by nobody', async () => {
    await expect(
      prisma.session.create({ data: { refreshTokenHash: 'h4', expiresAt: future() } }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate refresh token hash', async () => {
    const user = await newUser();
    await prisma.session.create({
      data: { userId: user.id, sessionVersion: 1, refreshTokenHash: 'same', expiresAt: future() },
    });
    await expect(
      prisma.session.create({
        data: { userId: user.id, sessionVersion: 1, refreshTokenHash: 'same', expiresAt: future() },
      }),
    ).rejects.toThrow();
  });

  it('refuses to delete a user that still has sessions', async () => {
    const user = await newUser();
    await prisma.session.create({
      data: { userId: user.id, sessionVersion: 1, refreshTokenHash: 'h5', expiresAt: future() },
    });
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});

describe('identity baseline: audit log', () => {
  it('allows inserts', async () => {
    const row = await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: 'test.created', changes: { ok: true } },
    });
    expect(row.id).toBeTruthy();
  });

  it('rejects UPDATE at the database level and leaves the row unchanged', async () => {
    const row = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'a' } });
    await expect(
      prisma.$executeRaw`UPDATE audit_logs SET action = 'b' WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe('a');
  });

  it('rejects DELETE at the database level and keeps the row', async () => {
    const row = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'a' } });
    await expect(
      prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count({ where: { id: row.id } })).toBe(1);
  });

  it('also rejects UPDATE and DELETE issued through the Prisma client', async () => {
    const row = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'a' } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'b' } }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe('identity baseline: scope', () => {
  it('creates only the four identity tables (plus the Prisma migrations table)', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      '_prisma_migrations',
      'admin_accounts',
      'audit_logs',
      'sessions',
      'users',
    ]);
  });
});
