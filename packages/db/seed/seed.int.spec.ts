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

  it('gives Raka Putra the two board chats, once, with seq 1..n and the right senders', async () => {
    const first = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(first.chatMessagesCreated).toBe(7);
    const second = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(second.chatMessagesCreated).toBe(0);
    const conversations = await prisma.conversation.findMany({
      include: { messages: { orderBy: { seq: 'asc' } }, customer: true },
    });
    expect(conversations).toHaveLength(2);
    for (const c of conversations) {
      expect(c.messages.map((m) => m.seq)).toEqual(c.messages.map((_, i) => i + 1));
      expect(c.lastMessageSeq).toBe(c.messages.length);
      expect(c.lastMessageAt).toEqual(c.messages[c.messages.length - 1]!.createdAt);
      expect(c.customer.displayName).toBe('Raka Putra');
    }
    const salsa = conversations.find((c) => c.messages.length === 3)!;
    expect(salsa.messages.map((m) => m.senderUserId === salsa.customerId)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('gives Raka Putra read cursors so Salsa has 2 unread creator messages and Kirana none, once, never moved by a re-seed', async () => {
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const reads = await prisma.conversationRead.findMany({
      include: { conversation: { include: { messages: true, creator: true } } },
    });
    expect(reads).toHaveLength(2);
    const unread = (r: (typeof reads)[number]) =>
      r.conversation.messages.filter((m) => m.senderUserId !== r.userId && m.seq > r.lastReadSeq)
        .length;
    const byCode = new Map(reads.map((r) => [r.conversation.creator.publicCode, r]));
    expect(unread(byCode.get('salsa234')!)).toBe(2);
    expect(unread(byCode.get('kirana23')!)).toBe(0);
    // a cursor that moved later is not reset by the next seed
    await prisma.conversationRead.update({
      where: {
        conversationId_userId: {
          conversationId: byCode.get('salsa234')!.conversationId,
          userId: byCode.get('salsa234')!.userId,
        },
      },
      data: { lastReadSeq: 3 },
    });
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const after = await prisma.conversationRead.findUniqueOrThrow({
      where: {
        conversationId_userId: {
          conversationId: byCode.get('salsa234')!.conversationId,
          userId: byCode.get('salsa234')!.userId,
        },
      },
    });
    expect(after.lastReadSeq).toBe(3);
  });

  it('gives Raka Putra an active subscription to Salsa and an expired one to Kirana, once', async () => {
    const first = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(first.subscriptionsCreated).toBe(2);
    const second = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(second.subscriptionsCreated).toBe(0);
    const rows = await prisma.subscription.findMany({
      include: { customer: true, creator: { include: { user: true } } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.customer.displayName === 'Raka Putra')).toBe(true);
    const salsa = rows.find((r) => r.creator.user.displayName === 'Salsa');
    expect(salsa?.endsAt.toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(salsa?.revokedAt).toBeNull();
    const kirana = rows.find((r) => r.creator.user.displayName === 'Kirana');
    expect(kirana?.endsAt.toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });

  it('gives Maya and Raka one pending and Luna one rejected creator request, once', async () => {
    const first = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(first.applicationsCreated).toBe(3);
    const second = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(second.applicationsCreated).toBe(0);

    const rows = await prisma.creatorApplication.findMany({ include: { user: true } });
    expect(rows).toHaveLength(3);
    const maya = rows.find((r) => r.user.displayName === 'Maya Lestari');
    expect(maya).toMatchObject({ status: 'PENDING', reviewReason: null, reviewedAt: null });
    const luna = rows.find((r) => r.user.displayName === 'Luna Aurora');
    expect(luna).toMatchObject({ status: 'REJECTED', reviewedByAdminId: null });
    expect(luna?.reviewReason).toMatch(/^Link Instagram belum bisa kami verifikasi/);
    expect(luna?.reviewedAt?.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    const raka = rows.find((r) => r.user.displayName === 'Raka Putra');
    expect(raka).toMatchObject({ status: 'PENDING', creatorName: 'Raka Putra' });
  });

  it('leaves an existing request of the same status untouched on re-run', async () => {
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    await prisma.creatorApplication.updateMany({
      where: { status: 'PENDING', user: { telegramId: 9_000_000_011n } },
      data: { creatorName: 'Edited' },
    });
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(
      await prisma.creatorApplication.count({
        where: { status: 'PENDING', creatorName: 'Edited' },
      }),
    ).toBe(1);
  });

  it('gives the seed creators a type and an Instagram link, only when it creates them', async () => {
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const salsa = await prisma.creator.findUniqueOrThrow({ where: { publicCode: 'salsa234' } });
    expect(salsa).toMatchObject({
      creatorType: 'HUMAN',
      instagramUrl: 'https://instagram.com/salsa.maheswari',
    });
    await prisma.creator.update({
      where: { publicCode: 'salsa234' },
      data: { instagramUrl: null },
    });
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const again = await prisma.creator.findUniqueOrThrow({ where: { publicCode: 'salsa234' } });
    expect(again.instagramUrl).toBeNull();
  });

  it("keeps Raka Putra's subscription next to his pending request", async () => {
    await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    const raka = await prisma.user.findUniqueOrThrow({ where: { telegramId: 9_000_000_012n } });
    expect(
      await prisma.creatorApplication.count({ where: { userId: raka.id, status: 'PENDING' } }),
    ).toBe(1);
    expect(await prisma.subscription.count({ where: { customerId: raka.id } })).toBe(2);
  });

  it('gives Raka Putra one pending trial request to Dinda, once', async () => {
    const first = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(first.accessRequestsCreated).toBe(1);
    const second = await runSeed(prisma, { adminPassword: 'pw-pw-pw-pw-1' });
    expect(second.accessRequestsCreated).toBe(0);
    const rows = await prisma.accessRequest.findMany({
      include: { customer: true, creator: { include: { user: true } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'TRIAL', status: 'PENDING' });
    expect(rows[0]?.customer.displayName).toBe('Raka Putra');
    expect(rows[0]?.creator.user.displayName).toBe('Dinda');
    expect(rows[0]?.createdAt.toISOString()).toBe('2026-11-13T03:42:00.000Z');
  });
});
