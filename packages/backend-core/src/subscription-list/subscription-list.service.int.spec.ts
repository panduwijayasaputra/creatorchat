import { SubscriptionListQuerySchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionListService } from './subscription-list.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T05:00:00.000Z');
const service = new SubscriptionListService(prisma, () => NOW);
const DAY = 86_400_000;
const q = (o: Record<string, string> = {}) => SubscriptionListQuerySchema.parse(o);

let n = 60_000n;
let no = 0;
beforeEach(async () => {
  no = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Raka Putra', ...data } });
const makeCreator = async (
  name: string,
  status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE',
  avatarUrl?: string,
) => {
  const user = await makeUser({
    role: 'CREATOR',
    displayName: name,
    ...(avatarUrl ? { avatarUrl } : {}),
  });
  return prisma.creator.create({
    data: { userId: user.id, publicCode: `aaaaaaa${String.fromCharCode(97 + no++)}`, status },
  });
};
const sub = (
  customerId: string,
  creatorId: string,
  startDays: number,
  endDays: number,
  revoked = false,
) =>
  prisma.subscription.create({
    data: {
      customerId,
      creatorId,
      startsAt: new Date(NOW.getTime() + startDays * DAY),
      endsAt: new Date(NOW.getTime() + endDays * DAY),
      revokedAt: revoked ? NOW : null,
    },
  });

async function fixture() {
  const user = await makeUser();
  const salsa = await makeCreator('Salsa Maheswari', 'ACTIVE', 'https://img.example/s.png');
  const kirana = await makeCreator('Kirana Larasati', 'ACTIVE', 'http://img.example/k.png');
  const dinda = await makeCreator('Dinda_100%');
  await sub(user.id, salsa.id, -10, 11); // active, ends in 11 days
  await sub(user.id, kirana.id, -40, -10); // expired
  await sub(user.id, dinda.id, -5, 5, true); // revoked
  return { user, salsa, kirana, dinda };
}

describe('SubscriptionListService.list', () => {
  it('returns only this user’s rows with a derived status and an https-only avatar', async () => {
    const { user } = await fixture();
    const other = await makeUser();
    const x = await makeCreator('Other Creator');
    await sub(other.id, x.id, -1, 30);
    const r = await service.list(user.id, q());
    expect(r?.total).toBe(3);
    expect(r?.items.map((i) => [i.creator.display_name, i.status])).toEqual([
      ['Salsa Maheswari', 'ACTIVE'],
      ['Dinda_100%', 'REVOKED'],
      ['Kirana Larasati', 'EXPIRED'],
    ]);
    expect(r?.items[0]?.creator.avatar_url).toBe('https://img.example/s.png');
    expect(r?.items[2]?.creator.avatar_url).toBeNull();
    expect(Object.keys(r?.items[0] ?? {}).sort()).toEqual([
      'creator',
      'ends_at',
      'id',
      'revoked_at',
      'starts_at',
      'status',
    ]);
  });

  it('treats ends_at = now as expired', async () => {
    const user = await makeUser();
    const c = await makeCreator('Edge');
    await sub(user.id, c.id, -1, 0);
    expect((await service.list(user.id, q()))?.items[0]?.status).toBe('EXPIRED');
  });

  it('filters by status and by the Berakhir options', async () => {
    const { user } = await fixture();
    const names = async (o: Record<string, string>) =>
      (await service.list(user.id, q(o)))?.items.map((i) => i.creator.display_name);
    expect(await names({ status: 'active' })).toEqual(['Salsa Maheswari']);
    expect(await names({ status: 'expired' })).toEqual(['Kirana Larasati']);
    expect(await names({ status: 'revoked' })).toEqual(['Dinda_100%']);
    expect(await names({ ends: 'next30' })).toEqual(['Salsa Maheswari', 'Dinda_100%']);
    expect(await names({ ends: 'next7' })).toEqual(['Dinda_100%']);
    expect(await names({ ends: 'past' })).toEqual(['Kirana Larasati']);
  });

  it('searches case-insensitively with % _ and \\ taken literally', async () => {
    const { user } = await fixture();
    const names = async (s: string) =>
      (await service.list(user.id, q({ q: s })))?.items.map((i) => i.creator.display_name);
    expect(await names('salsa')).toEqual(['Salsa Maheswari']);
    expect(await names('%')).toEqual(['Dinda_100%']);
    expect(await names('_')).toEqual(['Dinda_100%']);
    expect(await names('a_a')).toEqual([]);
    expect(await names('\\')).toEqual([]);
  });

  it('sorts both ways with stable ties and pages without overlap', async () => {
    const { user } = await fixture();
    const order = async (o: Record<string, string>) =>
      (await service.list(user.id, q(o)))?.items.map((i) => i.creator.display_name);
    expect(await order({ sort: 'creator', dir: 'asc' })).toEqual([
      'Dinda_100%',
      'Kirana Larasati',
      'Salsa Maheswari',
    ]);
    expect(await order({ sort: 'creator', dir: 'desc' })).toEqual([
      'Salsa Maheswari',
      'Kirana Larasati',
      'Dinda_100%',
    ]);
    expect(await order({ sort: 'status', dir: 'asc' })).toEqual([
      'Salsa Maheswari',
      'Kirana Larasati',
      'Dinda_100%',
    ]);
    expect(await order({ sort: 'starts', dir: 'asc' })).toEqual([
      'Kirana Larasati',
      'Salsa Maheswari',
      'Dinda_100%',
    ]);
  });

  it('pages are disjoint, total is independent and a page past the end is empty', async () => {
    const user = await makeUser();
    for (let i = 0; i < 12; i++)
      await sub(user.id, (await makeCreator(`Cr ${String(i).padStart(2, '0')}`)).id, -1, i + 1);
    const page = (p: number) => service.list(user.id, { ...q(), page: p, page_size: 10 });
    const [p1, p2, p9] = [await page(1), await page(2), await page(9)];
    expect([p1?.total, p1?.items.length, p2?.items.length]).toEqual([12, 10, 2]);
    expect(new Set([...(p1?.items ?? []), ...(p2?.items ?? [])].map((i) => i.id)).size).toBe(12);
    expect(p9?.total).toBe(12);
    expect(p9?.items).toEqual([]);
  });

  it('answers null for unknown, malformed, creator and admin ids', async () => {
    const { salsa } = await fixture();
    const admin = await prisma.adminAccount.create({
      data: { username: 'x.admin', passwordHash: 'x' },
    });
    for (const id of [
      '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
      'nope',
      salsa.id,
      salsa.userId,
      admin.id,
    ]) {
      expect(await service.list(id, q())).toBeNull();
      expect(await service.grantableCreators(id)).toBeNull();
    }
  });
});

describe('SubscriptionListService.grantableCreators', () => {
  it('excludes active pairs and blocked creators but keeps expired and revoked pairs', async () => {
    const { user } = await fixture();
    await makeCreator('Blocked One', 'BLOCKED');
    await makeCreator('Fresh Creator');
    const r = await service.grantableCreators(user.id);
    expect(r?.items.map((i) => i.display_name)).toEqual([
      'Dinda_100%',
      'Fresh Creator',
      'Kirana Larasati',
    ]);
  });
});
