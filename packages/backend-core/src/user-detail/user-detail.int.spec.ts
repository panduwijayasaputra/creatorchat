import { HistoryQuerySchema, UserRequestsQuerySchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { UserDetailService } from './user-detail.service.js';
import { UserHistoryService } from './user-history.service.js';
import { UserRequestsService } from './user-requests.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);
const details = new UserDetailService(prisma, { clock: () => NOW });
const requests = new UserRequestsService(prisma, { clock: () => NOW });
const history = new UserHistoryService(prisma);
const rq = (input: Record<string, string> = {}) => UserRequestsQuerySchema.parse(input);
const hq = (input: Record<string, string> = {}) => HistoryQuerySchema.parse(input);
const GHOST = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

let tg = 800_000n;
let code = 0;
const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });
const app = (
  userId: string,
  status: 'PENDING' | 'REJECTED' | 'APPROVED',
  ageDays: number,
  extra: Record<string, unknown> = {},
) =>
  prisma.creatorApplication.create({
    data: {
      userId,
      creatorName: 'App',
      instagramUrl: 'https://instagram.com/x',
      creatorType: 'HUMAN',
      description: `desc ${ageDays}`,
      status,
      createdAt: at(-ageDays),
      ...(status !== 'PENDING' ? { reviewedAt: at(-ageDays + 1) } : {}),
      ...(status === 'REJECTED' ? { reviewReason: `alasan ${ageDays}` } : {}),
      ...extra,
    },
  });
async function creator(name: string) {
  const u = await user(name, { role: 'CREATOR' });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `usr${'abcdefgh'[code++ % 8]}${'abcdefgh'[Math.floor(code / 8)]}bbb`.slice(0, 8),
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

describe('UserDetailService', () => {
  it('a user with no request', async () => {
    const u = await user('Dimas', { bio: 'halo', avatarUrl: 'http://insecure/x.png' });
    const r = (await details.get(u.id))!;
    expect(r).toMatchObject({
      role: 'USER',
      user: { id: u.id, display_name: 'Dimas', avatar_url: null, bio: 'halo', status: 'ACTIVE' },
      creator_request: {
        status: 'NONE',
        submitted_at: null,
        rejection_count: 0,
        latest_request_id: null,
      },
      subscriptions: { active_count: 0, expired_count: 0, nearest_end: null },
      block: null,
    });
  });

  it('request state, rejection count and last rejection', async () => {
    const u = await user('Raka');
    await app(u.id, 'REJECTED', 20);
    await app(u.id, 'REJECTED', 10);
    const p = await app(u.id, 'PENDING', 1);
    const r = (await details.get(u.id))! as Extract<
      Awaited<ReturnType<typeof details.get>>,
      { role: 'USER' }
    >;
    expect(r.creator_request).toMatchObject({
      status: 'PENDING',
      rejection_count: 2,
      latest_request_id: p.id,
      submitted_at: at(-1).toISOString(),
      last_rejected_at: at(-9).toISOString(),
    });
    const x = await user('Luna');
    const rej = await app(x.id, 'REJECTED', 5);
    expect(
      ((await details.get(x.id)) as { creator_request: unknown }).creator_request,
    ).toMatchObject({ status: 'REJECTED', latest_request_id: rej.id });
  });

  it('subscription counts and nearest end: revoked and future never count', async () => {
    const u = await user('Raka');
    const [a, b, c, d, e] = [
      await creator('Salsa'),
      await creator('Kirana'),
      await creator('C3'),
      await creator('C4'),
      await creator('C5'),
    ];
    await sub(u.id, a.c.id, -5, 20);
    await sub(u.id, b.c.id, -5, 9);
    await sub(u.id, c.c.id, -30, -2);
    await sub(u.id, d.c.id, -5, 20, { revokedAt: NOW });
    await sub(u.id, e.c.id, 3, 30);
    const r = (await details.get(u.id))! as { subscriptions: unknown };
    expect(r.subscriptions).toEqual({
      active_count: 2,
      expired_count: 1,
      nearest_end: { creator_name: 'Kirana', ends_at: at(9).toISOString() },
    });
  });

  it('a blocked user shows the block entry; without an entry the reason is null', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'x' },
    });
    const u = await user('Dimas', { status: 'BLOCKED' });
    expect(((await details.get(u.id)) as { block: unknown }).block).toMatchObject({
      reason: null,
      admin_label: null,
    });
    await log({
      action: 'user.account.blocked',
      actorType: 'ADMIN',
      actorId: admin.id,
      targetType: 'user',
      targetId: u.id,
      reason: 'penyalahgunaan',
      createdAt: at(-2),
    });
    expect(((await details.get(u.id)) as { block: unknown }).block).toEqual({
      reason: 'penyalahgunaan',
      admin_label: 'nadia.admin',
      at: at(-2).toISOString(),
    });
  });

  it('a creator id gives the redirect shape; admin, unknown and malformed ids are null', async () => {
    const { u, c } = await creator('Salsa');
    expect(await details.get(u.id)).toEqual({ role: 'CREATOR', creator_id: c.id });
    const admin = await prisma.adminAccount.create({
      data: { username: 'x.admin', passwordHash: 'x' },
    });
    for (const id of [admin.id, GHOST, 'nope', '']) expect(await details.get(id), id).toBeNull();
  });
});

describe('UserRequestsService', () => {
  it('ordinals stay fixed under filters; status, q, sort and paging change the result', async () => {
    const u = await user('Raka');
    const r1 = await app(u.id, 'REJECTED', 30);
    const r2 = await app(u.id, 'REJECTED', 20, { reviewReason: 'Link Instagram 100% salah' });
    const p = await app(u.id, 'PENDING', 1);
    const all = (await requests.list(u.id, rq()))!;
    expect(all.items.map((i) => [i.id, i.ordinal])).toEqual([
      [p.id, 3],
      [r2.id, 2],
      [r1.id, 1],
    ]);
    expect(all.items[0]?.summary).toBe('Menunggu peninjauan');
    expect(all.items[1]?.summary).toBe('Ditolak 28 Okt 2026: Link Instagram 100% salah');
    expect(
      (await requests.list(u.id, rq({ status: 'rejected' })))!.items.map((i) => i.ordinal),
    ).toEqual([2, 1]);
    expect(
      (await requests.list(u.id, rq({ status: 'pending' })))!.items.map((i) => i.ordinal),
    ).toEqual([3]);
    expect((await requests.list(u.id, rq({ q: 'INSTAGRAM' })))!.total).toBe(1);
    expect((await requests.list(u.id, rq({ q: '100%' })))!.total).toBe(1);
    expect((await requests.list(u.id, rq({ q: '_' })))!.total).toBe(0);
    expect((await requests.list(u.id, rq({ q: 'menunggu' })))!.total).toBe(1);
    expect((await requests.list(u.id, rq({ dir: 'asc' })))!.items.map((i) => i.ordinal)).toEqual([
      1, 2, 3,
    ]);
    expect((await requests.list(u.id, rq({ sort: 'status', dir: 'asc' })))!.items[0]?.status).toBe(
      'PENDING',
    );
    const page2 = (await requests.list(u.id, rq({ page: '2', page_size: '10' })))!;
    expect(page2).toMatchObject({ items: [], total: 3 });
  });

  it('banner data: pending request with the block of an active or future subscription only', async () => {
    const u = await user('Raka');
    const s = await creator('Salsa');
    const k = await creator('Kirana');
    await sub(u.id, s.c.id, -5, 10);
    await sub(u.id, k.c.id, 2, 20, { revokedAt: NOW });
    expect((await requests.list(u.id, rq()))!.pending).toBeNull();
    const p = await app(u.id, 'PENDING', 1);
    const r = (await requests.list(u.id, rq()))!;
    expect(r.pending).toEqual({
      id: p.id,
      subscription_block: { count: 1, creator_name: 'Salsa', ends_at: at(10).toISOString() },
    });
    expect((await requests.list(u.id, rq({ status: 'rejected' })))!.pending?.id).toBe(p.id);
  });

  it('IDOR: another user, a creator id and unknown ids are null', async () => {
    const a = await user('A');
    const b = await user('B');
    const mine = await app(a.id, 'PENDING', 1);
    expect(await requests.get(a.id, mine.id)).not.toBeNull();
    expect(await requests.get(b.id, mine.id)).toBeNull();
    const { u: cu } = await creator('Salsa');
    expect(await requests.get(cu.id, mine.id)).toBeNull();
    expect(await requests.list(cu.id, rq())).toBeNull();
    for (const id of [GHOST, 'nope']) {
      expect(await requests.get(a.id, id)).toBeNull();
      expect(await requests.list(id, rq())).toBeNull();
    }
    expect(await requests.get('nope', mine.id)).toBeNull();
  });

  it('request detail: pending with check, rejected with reviewer and log id', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'x' },
    });
    const u = await user('Raka');
    const s = await creator('Salsa');
    await sub(u.id, s.c.id, -1, 7);
    const rej = await app(u.id, 'REJECTED', 9, { reviewedByAdminId: admin.id });
    const entry = await log({
      action: 'creator.application.rejected',
      targetType: 'creator_application',
      targetId: rej.id,
    });
    const p = await app(u.id, 'PENDING', 1);
    const pending = (await requests.get(u.id, p.id))!;
    expect(pending).toMatchObject({
      request: { ordinal: 2, status: 'PENDING' },
      review: null,
      applicant: { display_name: 'Raka' },
      check: { block: { count: 1, creator_name: 'Salsa' } },
    });
    const rejected = (await requests.get(u.id, rej.id))!;
    expect(rejected).toMatchObject({
      request: { ordinal: 1, status: 'REJECTED' },
      check: null,
      review: { reason: 'alasan 9', reviewer_label: 'nadia.admin', log_id: entry.id },
    });
    expect(JSON.stringify(rejected)).not.toContain(admin.id);
    const noLog = await app(u.id, 'REJECTED', 15);
    expect((await requests.get(u.id, noLog.id))!.review?.log_id).toBeNull();
  });

  it('an approved application is not a request row', async () => {
    const { u } = await creator('Salsa');
    await app(u.id, 'APPROVED', 5);
    expect(await requests.list(u.id, rq())).toBeNull();
    const plain = await user('X');
    const approved = await app(plain.id, 'APPROVED', 5);
    expect((await requests.list(plain.id, rq()))!.total).toBe(0);
    expect(await requests.get(plain.id, approved.id)).toBeNull();
  });
});

describe('UserHistoryService', () => {
  it("only this user's events; a rejected application's events appear under the user", async () => {
    const u = await user('Raka');
    const other = await user('Other');
    const a = await app(u.id, 'REJECTED', 9);
    const oa = await app(other.id, 'PENDING', 2);
    await log({
      action: 'user.account.created',
      targetType: 'user',
      targetId: u.id,
      createdAt: at(-12),
    });
    await log({
      action: 'creator.application.submitted',
      actorType: 'USER',
      actorId: u.id,
      targetType: 'creator_application',
      targetId: a.id,
      createdAt: at(-9),
    });
    await log({
      action: 'creator.application.rejected',
      targetType: 'creator_application',
      targetId: a.id,
      createdAt: at(-8),
    });
    await log({ action: 'user.account.created', targetType: 'user', targetId: other.id });
    await log({
      action: 'creator.application.submitted',
      targetType: 'creator_application',
      targetId: oa.id,
    });
    const r = (await history.list(u.id, hq()))!;
    expect(r.total).toBe(3);
    expect(r.items.map((i) => i.action)).toEqual(['Tolak creator', 'Ajukan creator', 'Bergabung']);
    expect((await history.list(u.id, hq({ q: 'bergabung' })))!.total).toBe(1);
    expect((await history.list(u.id, hq({ page: '9' })))!).toMatchObject({ items: [], total: 3 });
  });

  it('a creator, an unknown and a malformed id are null', async () => {
    const { u } = await creator('Salsa');
    for (const id of [u.id, GHOST, 'nope']) expect(await history.list(id, hq()), id).toBeNull();
  });
});
