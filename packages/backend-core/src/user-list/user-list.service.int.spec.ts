import { UserListQuerySchema, type UserListQuery } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountSecurityService } from '../account-security/account-security.service.js';
import { CreatorApprovalService } from '../creator-review/creator-approval.service.js';
import { UserListService } from './user-list.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const service = new UserListService(prisma, { clock: () => NOW });

let tg = 100_000n;
let codeNo = 0;
const list = (input: Record<string, string> = {}) =>
  service.list(UserListQuerySchema.parse(input) as UserListQuery);
const names = async (input: Record<string, string> = {}) =>
  (await list(input)).items.map((i) => i.display_name);

const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });

const application = (
  userId: string,
  status: 'PENDING' | 'REJECTED',
  ageDays: number,
  name = 'App',
) =>
  prisma.creatorApplication.create({
    data: {
      userId,
      creatorName: name,
      instagramUrl: 'https://instagram.com/x',
      creatorType: 'HUMAN',
      description: 'd',
      status,
      createdAt: daysAgo(ageDays),
      ...(status === 'REJECTED' ? { reviewedAt: NOW, reviewReason: 'r' } : {}),
    },
  });

async function creatorAccount(name: string) {
  const u = await user(name, { role: 'CREATOR' });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode:
        `creator${'abcdefgh'[codeNo++ % 8]}${'abcdefgh'[Math.floor(codeNo / 8) % 8]}`.slice(-8),
    },
  });
  return { user: u, creator: c };
}

const sub = (
  customerId: string,
  creatorId: string,
  startDays: number,
  endDays: number,
  extra = {},
) =>
  prisma.subscription.create({
    data: {
      customerId,
      creatorId,
      startsAt: new Date(NOW.getTime() + startDays * DAY),
      endsAt: new Date(NOW.getTime() + endDays * DAY),
      ...extra,
    },
  });

beforeEach(async () => {
  codeNo = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

describe('projection', () => {
  it('lists only USER accounts with their status; creators and admins never appear', async () => {
    await user('Ani');
    await user('Budi', { status: 'BLOCKED' });
    await creatorAccount('Cici');
    await prisma.adminAccount.create({ data: { username: 'nadia.admin', passwordHash: 'x' } });
    const r = await list({ sort: 'name', dir: 'asc' });
    expect(r.total).toBe(2);
    expect(r.items.map((i) => [i.display_name, i.status])).toEqual([
      ['Ani', 'ACTIVE'],
      ['Budi', 'BLOCKED'],
    ]);
  });

  it('removes a user from the list once the request is approved', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'x' },
    });
    const u = await user('Maya');
    const a = await application(u.id, 'PENDING', 1, 'Maya');
    expect(await names()).toEqual(['Maya']);
    const approvals = new CreatorApprovalService(prisma, new AccountSecurityService(prisma));
    expect((await approvals.approve(a.id, { adminId: admin.id })).kind).toBe('ok');
    expect(await names()).toEqual([]);
  });

  it('maps the latest application to the request state', async () => {
    await user('None');
    const p = await user('Pending');
    await application(p.id, 'PENDING', 1);
    const r = await user('Rejected');
    await application(r.id, 'REJECTED', 5);
    const again = await user('Again');
    await application(again.id, 'REJECTED', 9);
    await application(again.id, 'PENDING', 2);
    const twice = await user('Twice');
    await application(twice.id, 'REJECTED', 9);
    await application(twice.id, 'REJECTED', 3);
    const out = await list({ page_size: '50' });
    expect(out.total).toBe(5);
    expect(
      Object.fromEntries(out.items.map((i) => [i.display_name, i.creator_request_status])),
    ).toEqual({
      None: 'NONE',
      Pending: 'PENDING',
      Rejected: 'REJECTED',
      Again: 'PENDING',
      Twice: 'REJECTED',
    });
  });

  it('counts only active, started, non-revoked subscriptions', async () => {
    const u = await user('Sub');
    const c1 = await creatorAccount('C1');
    const c2 = await creatorAccount('C2');
    const c3 = await creatorAccount('C3');
    const c4 = await creatorAccount('C4');
    const c5 = await creatorAccount('C5');
    await sub(u.id, c1.creator.id, -5, 5);
    await sub(u.id, c2.creator.id, -5, 9);
    await sub(u.id, c3.creator.id, -20, -1); // expired
    await sub(u.id, c4.creator.id, -5, 5, { revokedAt: NOW }); // revoked
    await sub(u.id, c5.creator.id, 2, 9); // future
    expect((await list()).items[0]?.active_subscription_count).toBe(2);
  });

  it('carries exactly the contract columns', async () => {
    await user('Maya', {
      telegramUsername: 'maya',
      avatarUrl: 'http://insecure/x.png',
      bio: 'secret',
    });
    const row = (await list()).items[0]!;
    expect(Object.keys(row).sort()).toEqual([
      'active_subscription_count',
      'avatar_url',
      'creator_request_status',
      'display_name',
      'id',
      'joined_at',
      'pending_access_count',
      'status',
      'telegram_id',
      'telegram_username',
    ]);
    expect(row.avatar_url).toBeNull();
  });
});

describe('filters', () => {
  it('status and request filters change the result', async () => {
    await user('A');
    await user('B', { status: 'BLOCKED' });
    const p = await user('C');
    await application(p.id, 'PENDING', 1);
    const r = await user('D');
    await application(r.id, 'REJECTED', 1);
    expect(await names({ status: 'blocked' })).toEqual(['B']);
    expect(await names({ request: 'pending' })).toEqual(['C']);
    expect(await names({ request: 'pending,rejected', sort: 'name', dir: 'asc' })).toEqual([
      'C',
      'D',
    ]);
    expect(await names({ status: 'active', request: 'none' })).toEqual(['A']);
  });

  it('range uses the injected clock', async () => {
    await user('d3', { createdAt: daysAgo(3) });
    await user('d20', { createdAt: daysAgo(20) });
    await user('d60', { createdAt: daysAgo(60) });
    await user('d200', { createdAt: daysAgo(200) });
    expect(await names({ range: '7d' })).toEqual(['d3']);
    expect(await names({ range: '30d' })).toEqual(['d3', 'd20']);
    expect(await names({ range: '90d' })).toEqual(['d3', 'd20', 'd60']);
    expect((await names()).length).toBe(4);
  });

  it('searches by name, Telegram id prefix, case-insensitively, with LIKE characters literal', async () => {
    await user('Hendra Wijaya', { telegramId: 299017733n });
    await user('Putri 100%');
    await user('Putri 100x');
    await user('snake_case');
    await user('snakeXcase');
    expect(await names({ q: 'hENDRA' })).toEqual(['Hendra Wijaya']);
    expect(await names({ q: '2990' })).toEqual(['Hendra Wijaya']);
    expect(await names({ q: '100%' })).toEqual(['Putri 100%']);
    expect(await names({ q: 'snake_' })).toEqual(['snake_case']);
    expect(await names({ q: "'; DROP TABLE users; --" })).toEqual([]);
    expect((await list()).total).toBe(5);
  });
});

describe('sort and paging', () => {
  it('sorts every field in both directions with stable ties', async () => {
    const a = await user('Ani', { telegramUsername: 'zed', createdAt: daysAgo(1) });
    await user('Budi', { telegramUsername: 'amy', status: 'BLOCKED', createdAt: daysAgo(2) });
    const c = await user('Cici', { telegramUsername: 'mid', createdAt: daysAgo(3) });
    await application(c.id, 'PENDING', 1);
    const cr = await creatorAccount('Cr');
    await sub(a.id, cr.creator.id, -1, 5);
    const expectations: Record<string, string[]> = {
      name: ['Ani', 'Budi', 'Cici'],
      telegram: ['Budi', 'Cici', 'Ani'],
      status: ['Ani', 'Cici', 'Budi'],
      request: ['Ani', 'Budi', 'Cici'],
      date: ['Cici', 'Budi', 'Ani'],
    };
    for (const sort of ['name', 'telegram', 'status', 'request', 'date']) {
      expect(await names({ sort, dir: 'asc' }), sort).toEqual(expectations[sort]);
      expect(await names({ sort, dir: 'desc' }), sort + ' desc').toHaveLength(3);
    }
    expect(await names({ sort: 'subscriptions', dir: 'desc' })).toEqual(['Ani', 'Budi', 'Cici']);
    expect(await names({ sort: 'subscriptions', dir: 'asc' })).toEqual(['Budi', 'Cici', 'Ani']);
  });

  it('pages are disjoint, cover the whole set and report the real total', async () => {
    for (let i = 0; i < 23; i++)
      await user(`U${String(i).padStart(2, '0')}`, { createdAt: daysAgo(i % 3) });
    const seen: string[] = [];
    for (const page of ['1', '2', '3']) {
      const r = await list({ page });
      expect(r.total).toBe(23);
      seen.push(...r.items.map((i) => i.id));
    }
    expect(new Set(seen).size).toBe(23);
    const full = await list({ page_size: '50' });
    expect(full.items.map((i) => i.id)).toEqual(seen);
    const past = await list({ page: '9' });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(23);
    expect((await list({ page_size: '25' })).items).toHaveLength(23);
  });
});

describe('pending access requests (US-024)', () => {
  const pending = (customerId: string, creatorId: string, status = 'PENDING') =>
    prisma.accessRequest.create({
      data: {
        customerId,
        creatorId,
        type: 'TRIAL',
        status: status as 'PENDING',
        ...(status === 'REJECTED'
          ? { reviewedAt: NOW, reviewReason: 'Belum bisa.' }
          : status === 'APPROVED'
            ? { reviewedAt: NOW }
            : {}),
      },
    });

  it('counts only pending requests to active creators and filters on them', async () => {
    const a = await creatorAccount('Dinda');
    const b = await creatorAccount('Kirana');
    const blockedCreator = await creatorAccount('Citra');
    const blockedAccount = await creatorAccount('Fajar');
    await prisma.creator.update({
      where: { id: blockedCreator.creator.id },
      data: { status: 'BLOCKED' },
    });
    await prisma.user.update({
      where: { id: blockedAccount.user.id },
      data: { status: 'BLOCKED' },
    });

    const raka = await user('Raka');
    await pending(raka.id, a.creator.id);
    await pending(raka.id, b.creator.id);
    await pending(raka.id, blockedCreator.creator.id); // not counted
    await pending(raka.id, blockedAccount.creator.id); // not counted
    const maya = await user('Maya');
    await pending(maya.id, a.creator.id, 'REJECTED');
    await pending(maya.id, b.creator.id, 'APPROVED');
    await user('Nadia');

    const all = await list();
    const count = (name: string) =>
      all.items.find((i) => i.display_name === name)?.pending_access_count;
    expect(count('Raka')).toBe(2);
    expect(count('Maya')).toBe(0);
    expect(count('Nadia')).toBe(0);

    const only = await list({ access: 'pending' });
    expect(only.items.map((i) => i.display_name)).toEqual(['Raka']);
    expect(only.total).toBe(1);
    expect((await list({ access: 'any' })).total).toBe(3);
  });

  it('combines with the other filters and paging', async () => {
    const a = await creatorAccount('Dinda');
    const raka = await user('Raka');
    const rina = await user('Rina', { status: 'BLOCKED' });
    await pending(raka.id, a.creator.id);
    await pending(rina.id, a.creator.id);
    expect(await names({ access: 'pending', status: 'blocked' })).toEqual(['Rina']);
    expect((await names({ access: 'pending', q: 'r' })).sort()).toEqual(['Raka', 'Rina']);
    expect(await names({ access: 'pending', q: 'ra' })).toEqual(['Raka']);
    const page = await list({ access: 'pending', page_size: '10', page: '2' });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(2);
  });
});
