import { CreatorListQuerySchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountSecurityService } from '../account-security/account-security.service.js';
import { CreatorApprovalService } from '../creator-review/creator-approval.service.js';
import { CreatorListService } from './creator-list.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const service = new CreatorListService(prisma, { clock: () => NOW });

let tg = 100_000n;
let codeNo = 0;
const query = (input: Record<string, string> = {}) => CreatorListQuerySchema.parse(input);
const list = (input: Record<string, string> = {}) => service.list(query(input));
const names = async (input: Record<string, string> = {}) =>
  (await list(input)).items.map((i) => i.creator_name);

const user = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: 'Someone', ...data } });

async function request(
  name: string,
  opts: {
    daysAgo?: number;
    type?: 'HUMAN' | 'AI_CHARACTER';
    user?: Record<string, unknown>;
    status?: 'PENDING' | 'REJECTED';
  } = {},
) {
  const u = await user({ displayName: name, ...opts.user });
  const status = opts.status ?? 'PENDING';
  const a = await prisma.creatorApplication.create({
    data: {
      userId: u.id,
      creatorName: name,
      instagramUrl: `https://instagram.com/${name.toLowerCase().replace(/\W/g, '.')}`,
      creatorType: opts.type ?? 'HUMAN',
      description: 'd',
      status,
      createdAt: daysAgo(opts.daysAgo ?? 1),
      ...(status === 'REJECTED' ? { reviewedAt: NOW, reviewReason: 'r' } : {}),
    },
  });
  return { user: u, application: a };
}

async function creator(
  name: string,
  opts: {
    daysAgo?: number;
    status?: 'ACTIVE' | 'BLOCKED';
    type?: 'HUMAN' | 'AI_CHARACTER';
    instagram?: string | null;
  } = {},
) {
  const u = await user({ displayName: name, role: 'CREATOR' });
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const code = `${letters[codeNo % 26]}${letters[Math.floor(codeNo / 26) % 26]}bbbbbb`;
  codeNo += 1;
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: code,
      status: opts.status ?? 'ACTIVE',
      creatorType: opts.type ?? 'HUMAN',
      instagramUrl: opts.instagram === undefined ? `https://instagram.com/${code}` : opts.instagram,
      createdAt: daysAgo(opts.daysAgo ?? 10),
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
  it('lists pending requests and creator accounts, never approved or rejected applications', async () => {
    await request('Maya');
    await request('Luna', { status: 'REJECTED' });
    await creator('Tika');
    await creator('Fajar', { status: 'BLOCKED' });
    const r = await list();
    expect(r.total).toBe(3);
    expect(Object.fromEntries(r.items.map((i) => [i.creator_name, [i.kind, i.status]]))).toEqual({
      Maya: ['request', 'REQUEST'],
      Tika: ['creator', 'ACTIVE'],
      Fajar: ['creator', 'BLOCKED'],
    });
  });

  it('shows one request row for a user who resubmitted after a rejection', async () => {
    const first = await request('Luna', { status: 'REJECTED' });
    await prisma.creatorApplication.create({
      data: {
        userId: first.user.id,
        creatorName: 'Luna 2',
        instagramUrl: 'https://instagram.com/l2',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    expect(await names()).toEqual(['Luna 2']);
  });

  it('turns an approved request into one ACTIVE row, not two', async () => {
    const admin = await prisma.adminAccount.create({
      data: { username: 'nadia.admin', passwordHash: 'x' },
    });
    const { application } = await request('Maya');
    const approvals = new CreatorApprovalService(prisma, new AccountSecurityService(prisma));
    expect((await approvals.approve(application.id, { adminId: admin.id })).kind).toBe('ok');
    const r = await list();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'creator', status: 'ACTIVE', creator_name: 'Maya' });
  });

  it('carries the display columns and nothing else', async () => {
    const { user: u } = await request('Maya', {
      type: 'AI_CHARACTER',
      user: { telegramUsername: 'mayal', avatarUrl: 'https://x.test/a.png' },
    });
    const [row] = (await list()).items;
    expect(row).toEqual({
      kind: 'request',
      id: expect.any(String),
      status: 'REQUEST',
      creator_name: 'Maya',
      avatar_url: 'https://x.test/a.png',
      telegram_username: 'mayal',
      telegram_id: u.telegramId.toString(),
      instagram_url: 'https://instagram.com/maya',
      creator_type: 'AI_CHARACTER',
      subscriber_count: null,
      has_active_subscription: false,
      date: daysAgo(1).toISOString(),
    });
  });

  it('drops a non-https avatar', async () => {
    await request('Maya', { user: { avatarUrl: 'javascript:alert(1)' } });
    expect((await list()).items[0]?.avatar_url).toBeNull();
  });

  it('flags a request whose applicant has an active or future subscription, not a revoked or expired one', async () => {
    const { creator: c } = await creator('Salsa');
    const cases: [string, number, number, object, boolean][] = [
      ['Active', -2, 5, {}, true],
      ['Future', 3, 9, {}, true],
      ['Revoked', -2, 5, { revokedAt: NOW }, false],
      ['Expired', -9, -1, {}, false],
    ];
    for (const [name, s, e, extra] of cases) {
      const { user: u } = await request(name);
      await sub(u.id, c.id, s, e, extra);
    }
    await request('Plain');
    const flags = Object.fromEntries(
      (await list({ status: 'request' })).items.map((i) => [
        i.creator_name,
        i.has_active_subscription,
      ]),
    );
    expect(flags).toEqual({
      Active: true,
      Future: true,
      Revoked: false,
      Expired: false,
      Plain: false,
    });
  });

  it('counts only active, started, non-revoked subscriptions of a creator', async () => {
    const { creator: c } = await creator('Salsa');
    const mk = async (s: number, e: number, extra = {}) =>
      sub((await user()).id, c.id, s, e, extra);
    await mk(-5, 5);
    await mk(-5, 5);
    await mk(-9, -1); // expired
    await mk(2, 9); // not started
    await mk(-5, 5, { revokedAt: NOW });
    expect((await list()).items[0]?.subscriber_count).toBe(2);
  });
});

describe('filters', () => {
  beforeEach(async () => {
    await request('Maya Lestari', { daysAgo: 3, type: 'HUMAN' });
    await request('Luna Aurora', { daysAgo: 20, type: 'AI_CHARACTER' });
    await creator('Tika Wardani', { daysAgo: 60, type: 'HUMAN' });
    await creator('Nayla Putri', { daysAgo: 200, type: 'AI_CHARACTER' });
    await creator('Fajar Nugroho', { daysAgo: 100, status: 'BLOCKED' });
  });

  it('status', async () => {
    expect((await names({ status: 'request', sort: 'name', dir: 'asc' })).sort()).toEqual([
      'Luna Aurora',
      'Maya Lestari',
    ]);
    expect(await names({ status: 'blocked' })).toEqual(['Fajar Nugroho']);
    expect((await list({ status: 'active,blocked' })).total).toBe(3);
    expect((await list()).total).toBe(5);
  });

  it('type', async () => {
    expect((await list({ type: 'ai_character' })).total).toBe(2);
    expect((await list({ type: 'human' })).total).toBe(3);
  });

  it('range, from the injected clock', async () => {
    expect(await names({ range: '7d' })).toEqual(['Maya Lestari']);
    expect((await list({ range: '30d' })).total).toBe(2);
    expect((await list({ range: '90d' })).total).toBe(3);
    expect((await list({ range: 'all' })).total).toBe(5);
  });

  it('search by name, case-insensitively, and by requested name', async () => {
    expect(await names({ q: 'MAYA' })).toEqual(['Maya Lestari']);
    expect(await names({ q: 'uror' })).toEqual(['Luna Aurora']);
    expect((await list({ q: 'zzz' })).total).toBe(0);
  });

  it('search by Telegram id prefix', async () => {
    const first = await prisma.user.findFirstOrThrow({ where: { displayName: 'Maya Lestari' } });
    expect(await names({ q: first.telegramId.toString() })).toEqual(['Maya Lestari']);
    expect((await list({ q: first.telegramId.toString().slice(0, 4) })).total).toBe(5);
  });

  it('treats % _ and \\ literally and a quote as plain text', async () => {
    expect((await list({ q: '%' })).total).toBe(0);
    expect((await list({ q: '_' })).total).toBe(0);
    expect((await list({ q: '\\' })).total).toBe(0);
    expect((await list({ q: "'; DROP TABLE users; --" })).total).toBe(0);
    expect(await prisma.user.count()).toBe(5);
  });

  it('combines filters', async () => {
    expect(await names({ status: 'active,blocked', type: 'human', range: '90d' })).toEqual([
      'Tika Wardani',
    ]);
  });
});

describe('sort and pagination', () => {
  async function seedMany() {
    const { creator: big } = await creator('Zed Big', { daysAgo: 5 });
    const { creator: small } = await creator('Amy Small', { daysAgo: 5 }); // same date: a tie
    await sub((await user()).id, big.id, -1, 9);
    await sub((await user()).id, big.id, -1, 9);
    await sub((await user()).id, small.id, -1, 9);
    await request('Maya Request', { daysAgo: 2 });
    await request('Beta Request', { daysAgo: 9, type: 'AI_CHARACTER' });
  }

  it('sorts every allowlisted field in both directions', async () => {
    await seedMany();
    const first = async (sort: string, dir: string) => (await names({ sort, dir }))[0];
    expect(await first('name', 'asc')).toBe('Amy Small');
    expect(await first('name', 'desc')).toBe('Zed Big');
    expect(await first('date', 'desc')).toBe('Maya Request');
    expect(await first('date', 'asc')).toBe('Beta Request');
    expect(await first('status', 'asc')).toMatch(/Amy Small|Zed Big/);
    expect(await first('status', 'desc')).toMatch(/Request/);
    expect(await first('type', 'asc')).toBe('Beta Request');
    expect(await first('telegram', 'asc')).toBeDefined();
    expect(await first('subscribers', 'desc')).toBe('Zed Big');
    expect(await first('subscribers', 'asc')).toBe('Amy Small');
  });

  it('puts requests (no subscriber count) last in both directions', async () => {
    await seedMany();
    for (const dir of ['asc', 'desc']) {
      const rows = (await list({ sort: 'subscribers', dir })).items;
      expect(rows.slice(-2).every((r) => r.kind === 'request')).toBe(true);
    }
  });

  it('orders ties by date then id, so repeated calls agree', async () => {
    await seedMany();
    const a = await names({ sort: 'type' });
    expect(await names({ sort: 'type' })).toEqual(a);
  });

  it('pages are disjoint and together equal the whole ordered set; total ignores the page', async () => {
    for (let i = 0; i < 27; i += 1)
      await creator(`Creator ${String(i).padStart(2, '0')}`, { daysAgo: i + 1 });
    const whole = (await list({ page_size: '50' })).items.map((i) => i.id);
    expect(whole).toHaveLength(27);
    const seen: string[] = [];
    for (const page of ['1', '2', '3']) {
      const r = await list({ page, page_size: '10' });
      expect(r.total).toBe(27);
      expect(r.page).toBe(Number(page));
      seen.push(...r.items.map((i) => i.id));
    }
    expect(seen).toEqual(whole);
    expect((await list({ page_size: '25' })).items).toHaveLength(25);
  });

  it('answers a page past the end with no rows and the true total', async () => {
    await creator('Only');
    expect(await list({ page: '9' })).toMatchObject({
      items: [],
      total: 1,
      page: 9,
      page_size: 10,
    });
  });
});
