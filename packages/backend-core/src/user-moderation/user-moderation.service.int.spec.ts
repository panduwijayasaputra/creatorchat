import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountSecurityService } from '../account-security/account-security.service.js';
import { CreatorApprovalService } from '../creator-review/creator-approval.service.js';
import { UserModerationService } from './user-moderation.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:02:00.000Z');
const DAY = 86_400_000;
const security = new AccountSecurityService(prisma);
const service = new UserModerationService(prisma, security, () => NOW);

let n = 40_000n;
let adminId = '';
let codeNo = 0;

beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
  adminId = (
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
  ).id;
});
afterAll(() => prisma.$disconnect());

const makeUser = async (data: Record<string, unknown> = {}) => {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Raka Putra', ...data },
  });
  await prisma.session.createMany({
    data: [1, 2].map(() => ({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(NOW.getTime() + DAY),
    })),
  });
  return user;
};

const subscribe = async (customerId: string, startDays: number, endDays: number, extra = {}) => {
  const owner = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  const creator = await prisma.creator.create({
    data: { userId: owner.id, publicCode: `ab${String.fromCharCode(97 + codeNo++)}bbbbb` },
  });
  return prisma.subscription.create({
    data: {
      customerId,
      creatorId: creator.id,
      startsAt: new Date(NOW.getTime() + startDays * DAY),
      endsAt: new Date(NOW.getTime() + endDays * DAY),
      ...extra,
    },
  });
};

const ctx = (reason = 'Penyalahgunaan layanan berulang') => ({
  adminId,
  reason,
  requestId: 'req-1',
});
const audits = () => prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
const snapshot = async () => ({
  subs: await prisma.subscription.findMany({ orderBy: { id: 'asc' } }),
  apps: await prisma.creatorApplication.findMany({ orderBy: { id: 'asc' } }),
});

describe('block', () => {
  it('blocks, bumps the version, revokes live sessions and writes one audit row with the reason', async () => {
    const user = await makeUser();
    expect(await service.block(user.id, ctx())).toEqual({ kind: 'ok' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ status: 'BLOCKED', sessionVersion: user.sessionVersion + 1 });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'user.account.blocked',
      actorType: 'ADMIN',
      actorId: adminId,
      targetType: 'user',
      targetId: user.id,
      reason: 'Penyalahgunaan layanan berulang',
      requestId: 'req-1',
    });
  });

  it('leaves subscriptions and a pending creator request untouched', async () => {
    const user = await makeUser();
    await subscribe(user.id, -2, 9);
    await prisma.creatorApplication.create({
      data: {
        userId: user.id,
        creatorName: 'Raka',
        instagramUrl: 'https://instagram.com/raka',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    const before = await snapshot();
    await service.block(user.id, ctx());
    expect(await snapshot()).toEqual(before);
    expect(before.apps[0]?.status).toBe('PENDING');
    await service.unblock(user.id, ctx('Banding diterima'));
    expect(await snapshot()).toEqual(before);
  });

  it('answers a conflict when the user is already blocked, writing nothing', async () => {
    const user = await makeUser({ status: 'BLOCKED' });
    expect(await service.block(user.id, ctx())).toEqual({ kind: 'conflict', status: 'BLOCKED' });
    expect(await audits()).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(
      user.sessionVersion,
    );
  });

  it('refuses a creator and writes nothing', async () => {
    const user = await makeUser({ role: 'CREATOR' });
    expect(await service.block(user.id, ctx())).toEqual({ kind: 'role_conflict', role: 'CREATOR' });
    expect(await service.unblock(user.id, ctx())).toEqual({
      kind: 'role_conflict',
      role: 'CREATOR',
    });
    expect(await audits()).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
  });

  it('serialises two concurrent blocks into exactly one ok and one audit row', async () => {
    const user = await makeUser();
    const results = await Promise.all([
      service.block(user.id, ctx()),
      service.block(user.id, ctx()),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(['conflict', 'ok']);
    expect(await audits()).toHaveLength(1);
  });

  it('serialises a concurrent block and unblock without a deadlock', async () => {
    const user = await makeUser();
    const results = await Promise.all([
      service.block(user.id, ctx()),
      service.unblock(user.id, ctx()),
    ]);
    // Block first: both succeed in order. Unblock first: it conflicts (the user is ACTIVE).
    const [blocked, unblocked] = results;
    expect(blocked?.kind).toBe('ok');
    expect(['ok', 'conflict']).toContain(unblocked?.kind);
    const final = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(final.status).toBe(unblocked?.kind === 'ok' ? 'ACTIVE' : 'BLOCKED');
  });

  it('never both blocks the applicant and lets an approval through (block vs approval)', async () => {
    const user = await makeUser();
    const application = await prisma.creatorApplication.create({
      data: {
        userId: user.id,
        creatorName: 'Raka',
        instagramUrl: 'https://instagram.com/raka',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    const approvals = new CreatorApprovalService(prisma, security);
    const [blocked, approved] = await Promise.all([
      service.block(user.id, ctx()),
      approvals.approve(application.id, { adminId }),
    ]);
    const final = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (blocked.kind === 'ok') {
      expect(approved.kind).toBe('not_eligible');
      expect(final).toMatchObject({ status: 'BLOCKED', role: 'USER' });
    } else {
      expect(blocked.kind).toBe('role_conflict');
      expect(approved.kind).toBe('ok');
      expect(final).toMatchObject({ status: 'ACTIVE', role: 'CREATOR' });
    }
  });
});

describe('unblock', () => {
  it('restores ACTIVE, bumps the version again, audits, and changes no subscription', async () => {
    const user = await makeUser();
    await subscribe(user.id, -2, 9);
    await service.block(user.id, ctx());
    const blocked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const subs = await prisma.subscription.findMany();
    expect(await service.unblock(user.id, ctx('Banding diterima setelah peninjauan'))).toEqual({
      kind: 'ok',
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ status: 'ACTIVE', sessionVersion: blocked.sessionVersion + 1 });
    expect(await prisma.subscription.findMany()).toEqual(subs);
    const last = (await audits()).at(-1);
    expect(last).toMatchObject({
      action: 'user.account.unblocked',
      reason: 'Banding diterima setelah peninjauan',
    });
  });

  it('answers a conflict for an ACTIVE user', async () => {
    const user = await makeUser();
    expect(await service.unblock(user.id, ctx())).toEqual({ kind: 'conflict', status: 'ACTIVE' });
    expect(await audits()).toHaveLength(0);
  });
});

describe('ids and the pre-check', () => {
  it('answers not_found for unknown and malformed ids', async () => {
    for (const id of [
      '00000000-0000-4000-8000-000000000000',
      'not-a-uuid',
      '',
      "'; DROP TABLE users",
    ]) {
      expect(await service.block(id, ctx())).toEqual({ kind: 'not_found' });
      expect(await service.unblock(id, ctx())).toEqual({ kind: 'not_found' });
      expect(await service.getBlockCheck(id)).toBeNull();
    }
    expect(await prisma.adminAccount.count()).toBe(1);
  });

  it('counts only running, non-revoked subscriptions', async () => {
    const user = await makeUser();
    await subscribe(user.id, -2, 9); // active
    await subscribe(user.id, -9, -1); // expired
    await subscribe(user.id, 2, 9); // not started
    await subscribe(user.id, -2, 9, { revokedAt: NOW }); // revoked
    expect(await service.getBlockCheck(user.id)).toEqual({
      status: 'ACTIVE',
      role: 'USER',
      activeSubscriptions: 1,
      checkedAt: NOW,
    });
  });

  it('is read-only', async () => {
    const user = await makeUser();
    await service.getBlockCheck(user.id);
    expect(await audits()).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
  });
});
