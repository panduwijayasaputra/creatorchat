import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountSecurityService } from './account-security.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const service = new AccountSecurityService(prisma);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

let n = 9000n;
async function makeUser(role: 'USER' | 'CREATOR' = 'USER') {
  const user = await prisma.user.create({ data: { telegramId: n++, displayName: 'Maya', role } });
  await prisma.session.createMany({
    data: [1, 2].map(() => ({
      userId: user.id,
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(Date.now() + 3_600_000),
    })),
  });
  return user;
}
const reload = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const live = (id: string) => prisma.session.count({ where: { userId: id, revokedAt: null } });
const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('AccountSecurityService', () => {
  it('blocks: status, one version bump, sessions revoked, one audit row', async () => {
    const user = await makeUser();
    expect(await service.blockUser(user.id, { requestId: 'req-1', reason: 'spam' })).toEqual({
      kind: 'ok',
      changed: true,
    });
    const after = await reload(user.id);
    expect(after.status).toBe('BLOCKED');
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
    expect(await live(user.id)).toBe(0);
    const rows = await audits('user.account.blocked');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'SYSTEM',
      targetId: user.id,
      reason: 'spam',
      requestId: 'req-1',
    });
  });

  it('blocking an already blocked user changes nothing', async () => {
    const user = await makeUser();
    await service.blockUser(user.id);
    expect(await service.blockUser(user.id)).toEqual({ kind: 'ok', changed: false });
    expect((await reload(user.id)).sessionVersion).toBe(user.sessionVersion + 1);
    expect(await audits('user.account.blocked')).toHaveLength(1);
  });

  it('serializes concurrent blocks into exactly one bump', async () => {
    const user = await makeUser();
    const results = await Promise.all(Array.from({ length: 6 }, () => service.blockUser(user.id)));
    expect(results.filter((r) => r.kind === 'ok' && r.changed)).toHaveLength(1);
    expect((await reload(user.id)).sessionVersion).toBe(user.sessionVersion + 1);
    expect(await audits('user.account.blocked')).toHaveLength(1);
  });

  it('changes role: bumps, revokes sessions, records from/to; same role is a no-op', async () => {
    const user = await makeUser();
    expect(await service.changeRole(user.id, 'CREATOR')).toEqual({ kind: 'ok', changed: true });
    const after = await reload(user.id);
    expect(after.role).toBe('CREATOR');
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
    expect(await live(user.id)).toBe(0);
    expect((await audits('user.role.changed'))[0]?.changes).toEqual({ role: ['USER', 'CREATOR'] });
    expect(await service.changeRole(user.id, 'CREATOR')).toEqual({ kind: 'ok', changed: false });
    expect((await reload(user.id)).sessionVersion).toBe(user.sessionVersion + 1);
    expect(await prisma.creator.count()).toBe(0);
  });

  it('unblock reactivates the account, bumps again and leaves old sessions dead', async () => {
    const user = await makeUser();
    await service.blockUser(user.id);
    expect(await service.unblockUser(user.id, { actor: { type: 'ADMIN', id: UNKNOWN } })).toEqual({
      kind: 'ok',
      changed: true,
    });
    const after = await reload(user.id);
    expect(after.status).toBe('ACTIVE');
    expect(after.sessionVersion).toBe(user.sessionVersion + 2);
    expect(await live(user.id)).toBe(0);
    expect(await service.unblockUser(user.id)).toEqual({ kind: 'ok', changed: false });
    expect((await audits('user.account.unblocked'))[0]).toMatchObject({
      actorType: 'ADMIN',
      actorId: UNKNOWN,
    });
  });

  it('only touches the target user and reports an unknown user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await service.blockUser(a.id);
    expect(await live(b.id)).toBe(2);
    expect((await reload(b.id)).sessionVersion).toBe(b.sessionVersion);
    expect(await service.blockUser(UNKNOWN)).toEqual({ kind: 'not_found' });
    expect(await service.changeRole(UNKNOWN, 'CREATOR')).toEqual({ kind: 'not_found' });
  });
});
