import {
  CreatorSubscribersQuerySchema,
  SubscriptionEventsQuerySchema,
} from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorSubscribersService } from './creator-subscribers.service.js';
import { SubscriptionDetailService } from './subscription-detail.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);
const detail = new SubscriptionDetailService(prisma, () => NOW);
const subscribers = new CreatorSubscribersService(prisma, () => NOW);
const eq = (input: Record<string, string> = {}) => SubscriptionEventsQuerySchema.parse(input);
const sq = (input: Record<string, string> = {}) => CreatorSubscribersQuerySchema.parse(input);
const GHOST = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';

let tg = 500_000n;
let code = 0;
const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });
async function creator(name: string, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE') {
  const u = await user(name, { role: 'CREATOR' });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `sub${'abcdefgh'[code++ % 8]}${'abcdefgh'[Math.floor(code / 8) % 8]}bbb`.slice(
        0,
        8,
      ),
      status,
    },
  });
  return { u, c };
}
const sub = (customerId: string, creatorId: string, s: number, e: number, extra = {}) =>
  prisma.subscription.create({
    data: { customerId, creatorId, startsAt: at(s), endsAt: at(e), ...extra },
  });
const admin = (name = 'nadia.admin') =>
  prisma.adminAccount.create({ data: { username: name, passwordHash: 'x' } });
const event = (
  subscriptionId: string,
  adminId: string,
  type: 'GRANT' | 'EXTEND' | 'REVOKE',
  ageDays: number,
  extra = {},
) =>
  prisma.subscriptionEvent.create({
    data: {
      subscriptionId,
      adminId,
      type,
      reason: 'alasan rahasia',
      createdAt: at(-ageDays),
      ...extra,
    },
  });

beforeEach(async () => {
  code = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

describe('SubscriptionDetailService.get', () => {
  it('status, dates, creator, customer and the admin of the latest GRANT', async () => {
    const a1 = await admin('nadia.admin');
    const a2 = await admin('budi.admin');
    const u = await user('Raka', { telegramUsername: 'raka' });
    const { c } = await creator('Salsa');
    const s = await sub(u.id, c.id, -18, 12);
    await event(s.id, a1.id, 'GRANT', 18);
    await event(s.id, a2.id, 'GRANT', 5);
    const r = (await detail.get(u.id, s.id))!;
    expect(r).toMatchObject({
      subscription: {
        id: s.id,
        status: 'ACTIVE',
        source: 'ADMIN',
        created_by_label: 'budi.admin',
        revoked_at: null,
      },
      customer: { id: u.id, display_name: 'Raka', telegram_username: 'raka' },
      creator: { id: c.id, display_name: 'Salsa' },
    });
    expect(JSON.stringify(r)).not.toMatch(new RegExp(`${a1.id}|${a2.id}|alasan`));
  });

  it('expired (ends_at = now) and revoked; a subscription without events has no creator label', async () => {
    const u = await user('Raka');
    const { c } = await creator('Salsa');
    const k = await creator('Kirana');
    const expired = await sub(u.id, c.id, -20, 0);
    const revoked = await sub(u.id, k.c.id, -5, 20, { revokedAt: NOW });
    expect((await detail.get(u.id, expired.id))!.subscription).toMatchObject({
      status: 'EXPIRED',
      created_by_label: null,
    });
    expect((await detail.get(u.id, revoked.id))!.subscription).toMatchObject({ status: 'REVOKED' });
  });

  it('IDOR: another user, a creator id, an admin id and unknown ids are null', async () => {
    const a = await user('A');
    const b = await user('B');
    const { u: cu, c } = await creator('Salsa');
    const mine = await sub(a.id, c.id, -1, 5);
    const adm = await admin();
    expect(await detail.get(a.id, mine.id)).not.toBeNull();
    for (const [uid, sid] of [
      [b.id, mine.id],
      [cu.id, mine.id],
      [adm.id, mine.id],
      [GHOST, mine.id],
      [a.id, GHOST],
      ['nope', mine.id],
      [a.id, 'nope'],
    ] as const) {
      expect(await detail.get(uid, sid), `${uid}/${sid}`).toBeNull();
      expect(await detail.events(uid, sid, eq()), `${uid}/${sid}`).toBeNull();
    }
  });
});

describe('SubscriptionDetailService.events', () => {
  async function history() {
    const a1 = await admin('nadia.admin');
    const a2 = await admin('budi.admin');
    const u = await user('Raka');
    const { c } = await creator('Salsa');
    const s = await sub(u.id, c.id, -18, 12);
    const audit = await prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: a1.id, action: 'subscription.granted' },
    });
    await event(s.id, a1.id, 'GRANT', 18, {
      startsAt: at(-18),
      newEndsAt: at(12),
      auditLogId: audit.id,
    });
    await event(s.id, a2.id, 'EXTEND', 9, { previousEndsAt: at(3), newEndsAt: at(12) });
    await event(s.id, a1.id, 'REVOKE', 1, { newEndsAt: at(12) });
    const other = await sub((await user('Other')).id, c.id, -1, 4);
    await event(other.id, a1.id, 'GRANT', 1, { startsAt: at(-1), newEndsAt: at(4) });
    return { u, s, audit };
  }

  it('newest first with labels, summaries and the audit link; never the reason or admin id', async () => {
    const { u, s, audit } = await history();
    const r = (await detail.events(u.id, s.id, eq()))!;
    expect(r.total).toBe(3);
    expect(r.items.map((i) => [i.action, i.actor, i.summary, i.status])).toEqual([
      ['Cabut akses', 'nadia.admin', 'Akses dicabut', 'success'],
      ['Perpanjang akses', 'budi.admin', '9 hari (hingga 28 Nov 2026)', 'success'],
      ['Berikan akses', 'nadia.admin', '30 hari', 'success'],
    ]);
    expect(r.items.map((i) => i.log_id)).toEqual([null, null, audit.id]);
    expect(JSON.stringify(r)).not.toMatch(/alasan/);
  });

  it('sorts every field both ways, pages are disjoint and total is independent', async () => {
    const { u, s } = await history();
    const names = async (q: Record<string, string>) =>
      (await detail.events(u.id, s.id, eq(q)))!.items.map((i) => i.action);
    expect((await names({ sort: 'time', dir: 'asc' }))[0]).toBe('Berikan akses');
    expect(await names({ sort: 'action', dir: 'asc' })).toEqual([
      'Berikan akses',
      'Perpanjang akses',
      'Cabut akses',
    ]);
    expect(await names({ sort: 'action', dir: 'desc' })).toEqual([
      'Cabut akses',
      'Perpanjang akses',
      'Berikan akses',
    ]);
    expect((await names({ sort: 'actor', dir: 'asc' }))[0]).toBe('Perpanjang akses');
    expect((await detail.events(u.id, s.id, eq({ page: '9' })))!).toMatchObject({
      items: [],
      total: 3,
    });
  });
});

describe('CreatorSubscribersService.list', () => {
  async function world() {
    const { c } = await creator('Salsa');
    const { c: other } = await creator('Kirana');
    const make = async (
      name: string,
      s: number,
      e: number,
      extra = {},
      data: Record<string, unknown> = {},
    ) => sub((await user(name, data)).id, c.id, s, e, extra);
    await make(
      'Raka Putra',
      -18,
      12,
      {},
      { telegramUsername: 'rakaputra', telegramId: 691042285n },
    );
    await make('Nadia Kusuma', -30, -2, {}, { telegramUsername: 'nadiak' });
    await make('Dimas 100%', -5, 10, { revokedAt: NOW }, { status: 'BLOCKED' });
    await make('Bayu Setiawan', -3, 25);
    await sub((await user('Elsewhere')).id, other.id, -1, 9);
    return { c, other };
  }

  it('only this creator, status derived, blocked customers still listed', async () => {
    const { c } = await world();
    const r = (await subscribers.list(
      c.id,
      sq({ page_size: '50', sort: 'subscriber', dir: 'asc' }),
    ))!;
    expect(r.items.map((i) => [i.customer.display_name, i.status])).toEqual([
      ['Bayu Setiawan', 'ACTIVE'],
      ['Dimas 100%', 'REVOKED'],
      ['Nadia Kusuma', 'EXPIRED'],
      ['Raka Putra', 'ACTIVE'],
    ]);
    expect(r.items[3]?.customer).toMatchObject({
      telegram_username: 'rakaputra',
      telegram_id: '691042285',
      avatar_url: null,
    });
  });

  it('filters, search (name, Telegram prefix, literal LIKE characters) and sorts change the result', async () => {
    const { c } = await world();
    const names = async (q: Record<string, string>) =>
      (await subscribers.list(
        c.id,
        sq({ page_size: '50', sort: 'subscriber', dir: 'asc', ...q }),
      ))!.items.map((i) => i.customer.display_name);
    expect(await names({ status: 'expired' })).toEqual(['Nadia Kusuma']);
    expect(await names({ status: 'revoked' })).toEqual(['Dimas 100%']);
    expect(await names({ ends: 'past' })).toEqual(['Nadia Kusuma']);
    expect(await names({ ends: 'next30' })).toEqual(['Bayu Setiawan', 'Dimas 100%', 'Raka Putra']);
    expect(await names({ ends: 'next7' })).toEqual([]);
    expect(await names({ q: 'RAKA' })).toEqual(['Raka Putra']);
    expect(await names({ q: '6910' })).toEqual(['Raka Putra']);
    expect(await names({ q: '100%' })).toEqual(['Dimas 100%']);
    expect(await names({ q: '%' })).toEqual(['Dimas 100%']);
    expect(await names({ q: "'; DROP TABLE users; --" })).toEqual([]);
    for (const sort of ['subscriber', 'telegram', 'status', 'starts', 'ends']) {
      const asc = await names({ sort, dir: 'asc' });
      expect(await names({ sort, dir: 'desc' }), sort).toHaveLength(asc.length);
    }
    expect((await names({ sort: 'ends', dir: 'asc' }))[0]).toBe('Nadia Kusuma');
  });

  it('pages are disjoint, total is independent, past the end is empty; non-creator ids are null', async () => {
    const { c } = await world();
    const p1 = (await subscribers.list(c.id, sq({ page_size: '10', sort: 'subscriber' })))!;
    expect(p1.total).toBe(4);
    expect((await subscribers.list(c.id, sq({ page: '9' })))!).toMatchObject({
      items: [],
      total: 4,
    });
    const pending = await user('Pending');
    const app = await prisma.creatorApplication.create({
      data: {
        userId: pending.id,
        creatorName: 'P',
        instagramUrl: 'https://instagram.com/p',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    for (const id of [pending.id, app.id, GHOST, 'nope', '']) {
      expect(await subscribers.list(id, sq()), id).toBeNull();
      expect(await subscribers.grantableUsers(id, null), id).toBeNull();
    }
  });
});

describe('CreatorSubscribersService.grantableUsers', () => {
  it('excludes entitled pairs, blocked users and creators; includes expired and revoked pairs; caps at 20', async () => {
    const { c } = await creator('Salsa');
    const active = await user('Active Fan');
    const expired = await user('Expired Fan');
    const revoked = await user('Revoked Fan');
    await user('Blocked Fan', { status: 'BLOCKED' });
    await user('Never Fan');
    await sub(active.id, c.id, -5, 5);
    await sub(expired.id, c.id, -20, -1);
    await sub(revoked.id, c.id, -5, 5, { revokedAt: NOW });
    const r = (await subscribers.grantableUsers(c.id, null))!;
    expect(r.creator_status).toBe('ACTIVE');
    expect(r.items.map((i) => i.display_name)).toEqual(['Expired Fan', 'Never Fan', 'Revoked Fan']);
    expect((await subscribers.grantableUsers(c.id, 'never'))!.items).toHaveLength(1);
    expect((await subscribers.grantableUsers(c.id, '%'))!.items).toHaveLength(0);
    for (let i = 0; i < 25; i++) await user(`Bulk ${String(i).padStart(2, '0')}`);
    expect((await subscribers.grantableUsers(c.id, null))!.items).toHaveLength(20);
    expect((await subscribers.grantableUsers(c.id, 'bulk'))!.items).toHaveLength(20);
  });

  it('a blocked creator has no grantable users', async () => {
    const { c } = await creator('Citra', 'BLOCKED');
    await user('Fan');
    expect(await subscribers.grantableUsers(c.id, null)).toEqual({
      creator_status: 'BLOCKED',
      items: [],
    });
  });
});
