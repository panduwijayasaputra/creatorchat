import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountSecurityService } from '../account-security/account-security.service.js';
import { CreatorModerationService } from './creator-moderation.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:02:00.000Z');
const DAY = 86_400_000;
const service = new CreatorModerationService(prisma, new AccountSecurityService(prisma), () => NOW);

let n = 30_000n;
let adminId = '';

beforeEach(async () => {
  await resetDatabase(prisma);
  adminId = (
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } })
  ).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const makeCreator = async (code = 'salsa234') => {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: 'Salsa', role: 'CREATOR' },
  });
  await prisma.session.createMany({
    data: [1, 2].map(() => ({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(NOW.getTime() + DAY),
    })),
  });
  const creator = await prisma.creator.create({ data: { userId: user.id, publicCode: code } });
  return { user, creator };
};

const subscribe = async (creatorId: string, startDays: number, endDays: number, extra = {}) => {
  const customer = await prisma.user.create({ data: { telegramId: n++, displayName: 'Cust' } });
  return prisma.subscription.create({
    data: {
      customerId: customer.id,
      creatorId,
      startsAt: new Date(NOW.getTime() + startDays * DAY),
      endsAt: new Date(NOW.getTime() + endDays * DAY),
      ...extra,
    },
  });
};

const ctx = (reason = 'Pelanggaran ketentuan') => ({ adminId, reason, requestId: 'req-1' });

describe('block', () => {
  it('blocks creator and account, bumps the version, revokes sessions, audits with reason and count', async () => {
    const { user, creator } = await makeCreator();
    await subscribe(creator.id, -1, 10);
    const result = await service.block(creator.id, ctx());
    expect(result).toEqual({ kind: 'ok', activeSubscribers: 1 });

    expect((await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } })).status).toBe(
      'BLOCKED',
    );
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('BLOCKED');
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'creator.blocked' } });
    expect(audit).toMatchObject({
      actorId: adminId,
      targetId: creator.id,
      reason: 'Pelanggaran ketentuan',
      requestId: 'req-1',
    });
    expect(audit.changes).toMatchObject({ active_subscribers: 1, user_id: user.id });
    expect(await prisma.auditLog.count({ where: { action: 'user.account.blocked' } })).toBe(1);
  });

  it('keeps subscriptions untouched', async () => {
    const { creator } = await makeCreator();
    const sub = await subscribe(creator.id, -1, 10);
    await service.block(creator.id, ctx());
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toEqual(sub);
  });

  it('answers conflict when already blocked and writes nothing', async () => {
    const { creator } = await makeCreator();
    await service.block(creator.id, ctx());
    const audits = await prisma.auditLog.count();
    expect(await service.block(creator.id, ctx())).toEqual({ kind: 'conflict', status: 'BLOCKED' });
    expect(await prisma.auditLog.count()).toBe(audits);
  });

  it('acts once for two parallel blocks', async () => {
    const { creator } = await makeCreator();
    const results = await Promise.all([
      service.block(creator.id, ctx()),
      service.block(creator.id, ctx()),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(['conflict', 'ok']);
    expect(await prisma.auditLog.count({ where: { action: 'creator.blocked' } })).toBe(1);
  });

  it('returns not_found for unknown and malformed ids', async () => {
    expect(await service.block('00000000-0000-4000-8000-000000000000', ctx())).toEqual({
      kind: 'not_found',
    });
    expect(await service.block('nope', ctx())).toEqual({ kind: 'not_found' });
    expect(await service.getBlockCheck('nope')).toBeNull();
  });
});

describe('unblock', () => {
  it('restores both to ACTIVE, audits, and grants or extends nothing', async () => {
    const { user, creator } = await makeCreator();
    const sub = await subscribe(creator.id, -1, 10);
    await service.block(creator.id, ctx());
    const result = await service.unblock(creator.id, ctx('Banding diterima'));
    expect(result).toEqual({ kind: 'ok' });
    expect((await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } })).status).toBe(
      'ACTIVE',
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toEqual(sub);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'creator.unblocked' },
    });
    expect(audit.reason).toBe('Banding diterima');
  });

  it('answers conflict for an active creator', async () => {
    const { creator } = await makeCreator();
    expect(await service.unblock(creator.id, ctx())).toEqual({
      kind: 'conflict',
      status: 'ACTIVE',
    });
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('serialises a block and an unblock without deadlock', async () => {
    const { creator } = await makeCreator();
    await service.block(creator.id, ctx());
    const results = await Promise.all([
      service.unblock(creator.id, ctx()),
      service.block(creator.id, ctx()),
    ]);
    expect(results.filter((r) => r.kind === 'ok').length).toBeGreaterThanOrEqual(1);
  });
});

describe('getBlockCheck', () => {
  it('counts only running, unrevoked subscriptions', async () => {
    const { creator } = await makeCreator();
    await subscribe(creator.id, -1, 10);
    await subscribe(creator.id, -20, -5);
    await subscribe(creator.id, 3, 30);
    await subscribe(creator.id, -1, 10, { revokedAt: NOW });
    expect(await service.getBlockCheck(creator.id)).toEqual({
      status: 'ACTIVE',
      activeSubscribers: 1,
      checkedAt: NOW,
    });
  });
});
