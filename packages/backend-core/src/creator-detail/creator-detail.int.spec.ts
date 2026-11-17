import { HistoryQuerySchema, type HistoryQuery } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogService } from './audit-log.service.js';
import { CreatorDetailService } from './creator-detail.service.js';
import { CreatorHistoryService } from './creator-history.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const details = new CreatorDetailService(prisma, { clock: () => NOW });
const history = new CreatorHistoryService(prisma, details);
const audits = new AuditLogService(prisma);
const q = (input: Record<string, string> = {}): HistoryQuery => HistoryQuerySchema.parse(input);

let tg = 700_000n;
let code = 0;
const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });
const app = (
  userId: string,
  status: 'PENDING' | 'REJECTED' | 'APPROVED',
  ageDays = 1,
  name = 'App',
) =>
  prisma.creatorApplication.create({
    data: {
      userId,
      creatorName: name,
      instagramUrl: 'https://instagram.com/x',
      creatorType: 'HUMAN',
      description: `desc ${name}`,
      status,
      createdAt: at(-ageDays),
      ...(status !== 'PENDING'
        ? { reviewedAt: NOW, ...(status === 'REJECTED' ? { reviewReason: 'r' } : {}) }
        : {}),
    },
  });
async function creator(name: string, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const u = await user(name, { role: 'CREATOR', bio: `bio ${name}` });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `crt${'abcdefgh'[code++ % 8]}${'abcdefgh'[Math.floor(code / 8)]}bbb`.slice(0, 8),
      status,
    },
  });
  return { u, c };
}
const sub = (customerId: string, creatorId: string, s: number, e: number, extra = {}) =>
  prisma.subscription.create({
    data: { customerId, creatorId, startsAt: at(s), endsAt: at(e), ...extra },
  });
const log = (data: Record<string, unknown>) =>
  prisma.auditLog.create({
    data: { actorType: 'SYSTEM', action: 'user.account.created', ...data } as never,
  });

beforeEach(async () => {
  code = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

describe('resolve / get', () => {
  it('a pending request: description, role, previous rejections and the subscription block', async () => {
    const u = await user('Maya', { avatarUrl: 'http://insecure/x.png' });
    await app(u.id, 'REJECTED', 9);
    await app(u.id, 'REJECTED', 5);
    const p = await app(u.id, 'PENDING', 1, 'Maya L');
    const { c, u: owner } = await creator('Salsa');
    await sub(u.id, c.id, -1, 10);
    await sub(u.id, c.id === c.id ? (await creator('Kirana')).c.id : c.id, 2, 20, {
      revokedAt: NOW,
    });
    void owner;
    const r = (await details.get(p.id))!;
    expect(r.checked_at).toBe(NOW.toISOString());
    expect(r.detail).toMatchObject({
      kind: 'request',
      id: p.id,
      status: 'REQUEST',
      creator_name: 'Maya L',
      avatar_url: null,
      creator: null,
      request: {
        id: p.id,
        description: 'desc Maya L',
        user_role: 'USER',
        previous_rejections: 2,
        subscription_block: { count: 1, creator_name: 'Salsa' },
      },
    });
  });

  it('no block for an expired or revoked subscription; first request has 0 rejections', async () => {
    const u = await user('Maya');
    const p = await app(u.id, 'PENDING');
    const { c } = await creator('Salsa');
    await sub(u.id, c.id, -20, -1);
    const r = (await details.get(p.id))!;
    expect(r.detail.request).toMatchObject({ previous_rejections: 0, subscription_block: null });
  });

  it('a creator: status, subscriber count (expired, revoked, future excluded), bio and description', async () => {
    const { u, c } = await creator('Salsa', 'BLOCKED');
    await app(u.id, 'APPROVED', 30, 'Salsa');
    const fans = await Promise.all([user('a'), user('b'), user('c'), user('d')]);
    await sub(fans[0]!.id, c.id, -5, 5);
    await sub(fans[1]!.id, c.id, -9, -1);
    await sub(fans[2]!.id, c.id, -5, 5, { revokedAt: NOW });
    await sub(fans[3]!.id, c.id, 2, 9);
    await log({
      action: 'creator.blocked',
      targetType: 'creator',
      targetId: c.id,
      createdAt: at(-2),
    });
    const r = (await details.get(c.id))!;
    expect(r.detail).toMatchObject({
      kind: 'creator',
      id: c.id,
      status: 'BLOCKED',
      creator_name: 'Salsa',
      request: null,
      blocked_at: at(-2).toISOString(),
      creator: {
        public_code: c.publicCode,
        subscriber_count: 0, // a blocked creator has no entitled subscribers (US-021)
        bio: 'bio Salsa',
        description: 'desc Salsa',
      },
    });
  });

  it('an approved application id resolves to the creator; a seed creator has no description', async () => {
    const { u, c } = await creator('Salsa');
    const a = await app(u.id, 'APPROVED', 3, 'Salsa');
    expect((await details.resolve(a.id))?.canonicalId).toBe(c.id);
    await prisma.creatorApplication.delete({ where: { id: a.id } });
    expect((await details.get(c.id))?.detail.creator?.description).toBeNull();
  });

  it('rejected application, user id, unknown and malformed ids are not found', async () => {
    const u = await user('Luna');
    const rej = await app(u.id, 'REJECTED');
    for (const id of [rej.id, u.id, '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33', 'nope', '']) {
      expect(await details.get(id), id).toBeNull();
      expect(await details.resolve(id), id).toBeNull();
    }
  });
});

describe('history', () => {
  async function world() {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'x' },
    });
    const u = await user('Maya');
    const a1 = await app(u.id, 'REJECTED', 9);
    const a2 = await app(u.id, 'PENDING', 1);
    const other = await user('Other');
    const otherApp = await app(other.id, 'PENDING', 2);
    const row = (data: Record<string, unknown>) => log(data);
    await row({
      action: 'user.account.created',
      targetType: 'user',
      targetId: u.id,
      createdAt: at(-12),
    });
    await row({
      action: 'creator.application.submitted',
      actorType: 'USER',
      actorId: u.id,
      targetType: 'creator_application',
      targetId: a1.id,
      createdAt: at(-9),
    });
    await row({
      action: 'creator.application.rejected',
      actorType: 'ADMIN',
      actorId: admin.id,
      targetType: 'creator_application',
      targetId: a1.id,
      reason: 'secret reason',
      createdAt: at(-8),
    });
    await row({
      action: 'creator.application.submitted',
      actorType: 'USER',
      actorId: u.id,
      targetType: 'creator_application',
      targetId: a2.id,
      createdAt: at(-1),
    });
    await row({
      action: 'user.login.blocked',
      targetType: 'user',
      targetId: u.id,
      createdAt: at(-3),
    });
    await row({
      action: 'creator.application.submitted',
      targetType: 'creator_application',
      targetId: otherApp.id,
    });
    await row({ action: 'user.account.created', targetType: 'user', targetId: other.id });
    return { u, a2, other };
  }

  it('lists only this person, labels and actors, Gagal for a blocked login', async () => {
    const { a2 } = await world();
    const r = (await history.list(a2.id, q()))!;
    expect(r.total).toBe(5);
    expect(r.items.map((i) => [i.action, i.actor, i.status])).toEqual([
      ['Ajukan creator', 'Maya', 'success'],
      ['Login diblokir', 'Sistem', 'failed'],
      ['Tolak creator', 'nadia.admin', 'success'],
      ['Ajukan creator', 'Maya', 'success'],
      ['Bergabung', 'Sistem', 'success'],
    ]);
    expect(JSON.stringify(r)).not.toContain('secret reason');
  });

  it('filters, search and sort change the result', async () => {
    const { a2 } = await world();
    const names = async (input: Record<string, string>) =>
      (await history.list(a2.id, q(input)))!.items.map((i) => i.action);
    expect(await names({ status: 'failed' })).toEqual(['Login diblokir']);
    expect(await names({ type: 'application' })).toHaveLength(3);
    expect(await names({ type: 'access' })).toEqual([]);
    expect(await names({ q: 'NADIA' })).toEqual(['Tolak creator']);
    expect(await names({ q: 'tolak creator' })).toEqual(['Tolak creator']);
    expect(await names({ q: '%' })).toEqual([]);
    for (const sort of ['time', 'actor', 'action', 'status']) {
      const asc = await names({ sort, dir: 'asc' });
      expect(await names({ sort, dir: 'desc' }), sort).toHaveLength(asc.length);
    }
    expect((await names({ sort: 'time', dir: 'asc' }))[0]).toBe('Bergabung');
  });

  it('pages are disjoint and total is independent; past the end is empty; unknown person is null', async () => {
    const { a2 } = await world();
    const p1 = (await history.list(a2.id, q({ page_size: '10' })))!;
    expect((await history.list(a2.id, q({ page: '9' })))!).toMatchObject({ items: [], total: 5 });
    expect(p1.items).toHaveLength(5);
    expect(await history.list('0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33', q())).toBeNull();
  });

  it("another person's events never appear and a creator's row events do", async () => {
    const { u, c } = await creator('Salsa');
    await log({ action: 'creator.blocked', targetType: 'creator', targetId: c.id });
    await log({ action: 'user.account.blocked', targetType: 'user', targetId: u.id });
    const { a2 } = await world();
    expect((await history.list(c.id, q()))!.items.map((i) => i.action).sort()).toEqual([
      'Block creator',
      'Block user',
    ]);
    expect((await history.list(a2.id, q()))!.items.some((i) => i.action.startsWith('Block'))).toBe(
      false,
    );
  });
});

describe('audit log detail', () => {
  it('returns only allowlisted lines and labelled actor / target', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'x' },
    });
    const { u, c } = await creator('Citra');
    const row = await log({
      action: 'creator.blocked',
      actorType: 'ADMIN',
      actorId: admin.id,
      targetType: 'creator',
      targetId: c.id,
      reason: 'Pelanggaran',
      requestId: 'req_7c1f',
      changes: {
        password: 'x',
        token: 'y',
        nested: { a: 1 },
        status: ['ACTIVE', 'BLOCKED'],
        active_subscribers: 12,
        user_id: u.id,
      },
    });
    const r = (await audits.get(row.id))!;
    expect(r).toMatchObject({
      actor: 'nadia.admin',
      action: 'Block creator',
      kind: 'access',
      target: 'Citra (creator)',
      status: 'success',
      reason: 'Pelanggaran',
      request_id: 'req_7c1f',
      before: [
        { label: 'Status', value: 'ACTIVE' },
        { label: 'Subscriber aktif', value: '12' },
      ],
      after: [
        { label: 'Status', value: 'BLOCKED' },
        { label: 'Subscriber aktif', value: '12' },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/password|token|nested|user_id/);
  });

  it('target labels, null changes, unknown and malformed ids', async () => {
    const u = await user('Maya');
    const a = await app(u.id, 'PENDING', 1, 'Maya L');
    const forUser = await log({ targetType: 'user', targetId: u.id });
    const forApp = await log({ targetType: 'creator_application', targetId: a.id, changes: null });
    expect((await audits.get(forUser.id))?.target).toBe('Maya (user)');
    const r = (await audits.get(forApp.id))!;
    expect(r.target).toBe('Maya L (pengajuan)');
    expect(r).toMatchObject({ before: [], after: [], actor: 'Sistem' });
    expect(await audits.get('0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33')).toBeNull();
    expect(await audits.get('nope')).toBeNull();
  });
});
