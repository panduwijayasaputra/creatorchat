import { ExploreQuerySchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorAccessService } from './creator-access.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);
const service = new CreatorAccessService(prisma, () => NOW);
const q = (input: Record<string, string> = {}) => ExploreQuerySchema.parse(input);

let tg = 400_000n;
let code = 0;
const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });
async function creator(
  name: string,
  data: {
    status?: 'ACTIVE' | 'BLOCKED';
    userStatus?: 'ACTIVE' | 'BLOCKED';
    avatarUrl?: string;
  } = {},
) {
  const u = await user(name, {
    role: 'CREATOR',
    status: data.userStatus ?? 'ACTIVE',
    bio: `bio ${name}`,
    ...(data.avatarUrl ? { avatarUrl: data.avatarUrl } : {}),
  });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `acc${'abcdefgh'[code++ % 8]}${'abcdefgh'[Math.floor(code / 8) % 8]}bbb`.slice(
        0,
        8,
      ),
      status: data.status ?? 'ACTIVE',
    },
  });
  return { u, c };
}
const sub = (customerId: string, creatorId: string, s: number, e: number, extra = {}) =>
  prisma.subscription.create({
    data: { customerId, creatorId, startsAt: at(s), endsAt: at(e), ...extra },
  });
const request = (customerId: string, creatorId: string, extra: Record<string, unknown> = {}) =>
  prisma.accessRequest.create({
    data: { customerId, creatorId, type: 'TRIAL', createdAt: at(-1), ...extra },
  });

beforeEach(async () => {
  code = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

describe('explore', () => {
  it('lists only ACTIVE creators by name; blocked creators, blocked accounts and applications never appear', async () => {
    const viewer = await user('Raka');
    await creator('Salsa');
    await creator('Dinda');
    await creator('Citra', { status: 'BLOCKED' });
    await creator('Fajar', { userStatus: 'BLOCKED' });
    const applicant = await user('Maya');
    await prisma.creatorApplication.create({
      data: {
        userId: applicant.id,
        creatorName: 'Maya',
        instagramUrl: 'https://instagram.com/m',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    const r = await service.explore(viewer.id, q());
    expect(r.items.map((i) => i.displayName)).toEqual(['Dinda', 'Salsa']);
    expect(r.total).toBe(2);
    expect(r.items[0]).toMatchObject({ bio: 'bio Dinda', access: null, avatarUrl: null });
  });

  it("shows the viewer's own state: the three states of the Explore board", async () => {
    const viewer = await user('Raka');
    const other = await user('Other');
    const salsa = await creator('Salsa');
    const dinda = await creator('Dinda');
    const kirana = await creator('Kirana');
    const lonely = await creator('Lonely');
    await sub(viewer.id, salsa.c.id, -18, 12);
    await request(viewer.id, dinda.c.id);
    await sub(viewer.id, kirana.c.id, -40, -10);
    await sub(other.id, lonely.c.id, -5, 5); // another customer's access never affects the viewer
    await request(other.id, lonely.c.id);
    const r = await service.explore(viewer.id, q());
    expect(Object.fromEntries(r.items.map((i) => [i.displayName, i.access]))).toEqual({
      Dinda: 'PENDING',
      Kirana: 'EXPIRED',
      Lonely: null,
      Salsa: 'ACTIVE',
    });
  });

  it('a revoked subscription is EXPIRED; an ends_at that passed a second ago is EXPIRED', async () => {
    const viewer = await user('Raka');
    const a = await creator('A');
    const b = await creator('B');
    await sub(viewer.id, a.c.id, -5, 5, { revokedAt: NOW });
    await prisma.subscription.create({
      data: {
        customerId: viewer.id,
        creatorId: b.c.id,
        startsAt: at(-5),
        endsAt: new Date(NOW.getTime() - 1000),
      },
    });
    const r = await service.explore(viewer.id, q());
    expect(r.items.map((i) => i.access)).toEqual(['EXPIRED', 'EXPIRED']);
  });

  it('pages are disjoint, total is independent, a page past the end is empty', async () => {
    const viewer = await user('Raka');
    for (let i = 0; i < 12; i++) await creator(`C${String(i).padStart(2, '0')}`);
    const p1 = await service.explore(viewer.id, q({ page_size: '10' }));
    const p2 = await service.explore(viewer.id, q({ page_size: '10', page: '2' }));
    expect(p1.items).toHaveLength(10);
    expect(p2.items).toHaveLength(2);
    expect(p1.total).toBe(12);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.publicCode)).size).toBe(12);
    expect(await service.explore(viewer.id, q({ page: '9' }))).toMatchObject({
      items: [],
      total: 12,
    });
  });

  it('drops a non-https avatar and carries no id, status or media', async () => {
    const viewer = await user('Raka');
    await creator('Salsa', { avatarUrl: 'http://insecure/x.png' });
    const item = (await service.explore(viewer.id, q())).items[0]!;
    expect(item.avatarUrl).toBeNull();
    expect(Object.keys(item).sort()).toEqual([
      'access',
      'avatarUrl',
      'bio',
      'displayName',
      'publicCode',
    ]);
  });
});

describe('profile', () => {
  it('returns each of the four states with the right dates', async () => {
    const viewer = await user('Raka');
    const guest = await creator('Guest');
    const pending = await creator('Pending');
    const active = await creator('Active');
    const expired = await creator('Expired');
    const revoked = await creator('Revoked');
    await request(viewer.id, pending.c.id, { type: 'RENEWAL' });
    const s = await sub(viewer.id, active.c.id, -18, 12);
    const e = await sub(viewer.id, expired.c.id, -40, -10);
    const r = await sub(viewer.id, revoked.c.id, -5, 20, { revokedAt: at(-2) });
    const access = async (c: { c: { publicCode: string } }) => {
      const out = await service.profile(viewer.id, c.c.publicCode);
      return out.kind === 'ok' ? out.access : null;
    };
    expect(await access(guest)).toEqual({ state: 'GUEST' });
    expect(await access(pending)).toMatchObject({ state: 'PENDING', type: 'RENEWAL' });
    expect(await access(active)).toEqual({ state: 'ACTIVE', endsAt: s.endsAt });
    expect(await access(expired)).toEqual({ state: 'EXPIRED', endedAt: e.endsAt, revoked: false });
    expect(await access(revoked)).toEqual({ state: 'EXPIRED', endedAt: at(-2), revoked: true });
    expect(r.endsAt > NOW).toBe(true);
  });

  it("another customer's access or request never shows", async () => {
    const viewer = await user('Raka');
    const other = await user('Other');
    const c = await creator('Salsa');
    await sub(other.id, c.c.id, -5, 5);
    await request(other.id, c.c.id);
    expect(await service.profile(viewer.id, c.c.publicCode)).toMatchObject({
      kind: 'ok',
      access: { state: 'GUEST' },
    });
  });

  it('unknown, malformed, blocked and inactive creators are not found', async () => {
    const viewer = await user('Raka');
    const blocked = await creator('Citra', { status: 'BLOCKED' });
    const inactive = await creator('Fajar', { userStatus: 'BLOCKED' });
    for (const code of [
      blocked.c.publicCode,
      inactive.c.publicCode,
      'abcdefgh',
      'nope',
      '',
      '../x',
    ]) {
      expect(await service.profile(viewer.id, code), code).toEqual({ kind: 'not_found' });
    }
  });

  it('carries only the public fields', async () => {
    const viewer = await user('Raka');
    const c = await creator('Salsa');
    const out = await service.profile(viewer.id, c.c.publicCode);
    expect(out.kind === 'ok' && Object.keys(out.creator).sort()).toEqual([
      'avatarUrl',
      'bio',
      'displayName',
      'publicCode',
    ]);
  });
});

describe('subscriptions (Langganan, US-025)', () => {
  const list = (userId: string) => service.subscriptions(userId);
  const states = async (userId: string) =>
    (await list(userId)).items.map((i) => `${i.displayName}:${i.access.state}`);

  it('shows the three board cards in order: Aktif, Menunggu, Berakhir', async () => {
    const raka = await user('Raka');
    const kirana = await creator('Kirana');
    const dinda = await creator('Dinda');
    const salsa = await creator('Salsa');
    await sub(raka.id, kirana.c.id, -40, -9);
    await request(raka.id, dinda.c.id);
    await sub(raka.id, salsa.c.id, -5, 11);
    expect(await states(raka.id)).toEqual(['Salsa:ACTIVE', 'Dinda:PENDING', 'Kirana:EXPIRED']);
    const [first] = (await list(raka.id)).items;
    expect(first).toMatchObject({
      displayName: 'Salsa',
      access: { state: 'ACTIVE', endsAt: at(11) },
      creatorAvailable: true,
    });
  });

  it('orders inside each group: soonest end, oldest request, latest end, then name', async () => {
    const raka = await user('Raka');
    const a1 = await creator('A-late');
    const a2 = await creator('B-soon');
    const p1 = await creator('P-new');
    const p2 = await creator('Q-old');
    const e1 = await creator('E-old');
    const e2 = await creator('F-recent');
    const tie1 = await creator('Z-tie');
    const tie2 = await creator('Y-tie');
    await sub(raka.id, a1.c.id, -1, 20);
    await sub(raka.id, a2.c.id, -1, 3);
    await request(raka.id, p1.c.id, { createdAt: at(-1) });
    await request(raka.id, p2.c.id, { createdAt: at(-5) });
    await sub(raka.id, e1.c.id, -60, -30);
    await sub(raka.id, e2.c.id, -60, -2);
    await sub(raka.id, tie1.c.id, -60, -10);
    await sub(raka.id, tie2.c.id, -60, -10);
    expect(await states(raka.id)).toEqual([
      'B-soon:ACTIVE',
      'A-late:ACTIVE',
      'Q-old:PENDING',
      'P-new:PENDING',
      'F-recent:EXPIRED',
      'Y-tie:EXPIRED',
      'Z-tie:EXPIRED',
      'E-old:EXPIRED',
    ]);
  });

  it('a revoked subscription is EXPIRED at its revocation time; pending beats ended', async () => {
    const raka = await user('Raka');
    const a = await creator('Revoked');
    const b = await creator('Renewing');
    await sub(raka.id, a.c.id, -5, 20, { revokedAt: at(-1) });
    await sub(raka.id, b.c.id, -40, -3);
    await request(raka.id, b.c.id, { type: 'RENEWAL' });
    const items = (await list(raka.id)).items;
    expect(items.find((i) => i.displayName === 'Revoked')?.access).toEqual({
      state: 'EXPIRED',
      endedAt: at(-1),
      revoked: true,
    });
    expect(items.find((i) => i.displayName === 'Renewing')?.access).toMatchObject({
      state: 'PENDING',
      type: 'RENEWAL',
    });
  });

  it('the expiry boundary is exact', async () => {
    const raka = await user('Raka');
    const a = await creator('Edge');
    await prisma.subscription.create({
      data: {
        customerId: raka.id,
        creatorId: a.c.id,
        startsAt: at(-5),
        endsAt: new Date(NOW.getTime() + 1000),
      },
    });
    expect((await list(raka.id)).items[0]?.access.state).toBe('ACTIVE');
    await prisma.subscription.updateMany({ data: { endsAt: NOW } });
    expect((await list(raka.id)).items[0]?.access.state).toBe('EXPIRED');
  });

  it('lists no creator without a subscription or a pending request (rejected, approved, none)', async () => {
    const raka = await user('Raka');
    const admin = await prisma.adminAccount.create({ data: { username: 'n', passwordHash: 'x' } });
    const rejected = await creator('Rejected');
    await creator('Nothing');
    await request(raka.id, rejected.c.id, {
      status: 'REJECTED',
      reviewedAt: at(-1),
      reviewedByAdminId: admin.id,
      reviewReason: 'Belum.',
    });
    expect((await list(raka.id)).items).toEqual([]);
  });

  it('keeps a blocked creator or creator account, marked unavailable', async () => {
    const raka = await user('Raka');
    const blocked = await creator('BlockedCreator', { status: 'BLOCKED' });
    const blockedAccount = await creator('BlockedAccount', { userStatus: 'BLOCKED' });
    const ok = await creator('Fine');
    await sub(raka.id, blocked.c.id, -5, 10);
    await request(raka.id, blockedAccount.c.id);
    await sub(raka.id, ok.c.id, -5, 20);
    const byName = new Map((await list(raka.id)).items.map((i) => [i.displayName, i]));
    expect(byName.get('BlockedCreator')).toMatchObject({
      creatorAvailable: false,
      access: { state: 'ACTIVE' },
    });
    expect(byName.get('BlockedAccount')?.creatorAvailable).toBe(false);
    expect(byName.get('Fine')?.creatorAvailable).toBe(true);
  });

  it("never shows another customer's subscription or request", async () => {
    const raka = await user('Raka');
    const other = await user('Other');
    const a = await creator('Salsa');
    const b = await creator('Dinda');
    await sub(other.id, a.c.id, -5, 10);
    await request(other.id, b.c.id);
    expect((await list(raka.id)).items).toEqual([]);
    expect(await states(other.id)).toEqual(['Salsa:ACTIVE', 'Dinda:PENDING']);
  });

  it('agrees with the profile state for every listed creator', async () => {
    const raka = await user('Raka');
    const a = await creator('Active');
    const b = await creator('Pending');
    const c = await creator('Expired');
    await sub(raka.id, a.c.id, -5, 10);
    await request(raka.id, b.c.id);
    await sub(raka.id, c.c.id, -40, -9);
    for (const card of (await list(raka.id)).items) {
      const profile = await service.profile(raka.id, card.publicCode);
      expect(profile).toMatchObject({ kind: 'ok', access: card.access });
    }
  });

  it('caps at 100 cards and carries only card fields', async () => {
    const raka = await user('Raka');
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    for (let i = 0; i < 101; i++) {
      const u = await user(`C${i}`, { role: 'CREATOR' });
      const c = await prisma.creator.create({
        data: {
          userId: u.id,
          publicCode: `cap${alphabet[Math.floor(i / 32)]}${alphabet[i % 32]}bbb`.slice(0, 8),
        },
      });
      await sub(raka.id, c.id, -5, 10 + i);
    }
    const items = (await list(raka.id)).items;
    expect(items).toHaveLength(100);
    expect(Object.keys(items[0]!).sort()).toEqual([
      'access',
      'avatarUrl',
      'conversationId',
      'creatorAvailable',
      'displayName',
      'publicCode',
    ]);
  });

  it('a customer with no relation gets an empty list', async () => {
    expect((await list((await user('Nobody')).id)).items).toEqual([]);
  });
});

describe('conversationId (US-027)', () => {
  it("is the viewer's own conversation on the profile and on every Langganan card, or null", async () => {
    const raka = await user('Raka');
    const other = await user('Other');
    const withChat = await creator('WithChat');
    const without = await creator('Without');
    await sub(raka.id, withChat.c.id, -5, 10);
    await sub(raka.id, without.c.id, -5, 10);
    const mine = await prisma.conversation.create({
      data: { customerId: raka.id, creatorId: withChat.c.id },
    });
    await prisma.conversation.create({ data: { customerId: other.id, creatorId: without.c.id } });

    const byName = new Map(
      (await service.subscriptions(raka.id)).items.map((i) => [i.displayName, i]),
    );
    expect(byName.get('WithChat')?.conversationId).toBe(mine.id);
    expect(byName.get('Without')?.conversationId).toBeNull(); // another customer's chat never leaks

    const a = await service.profile(raka.id, withChat.c.publicCode);
    const b = await service.profile(raka.id, without.c.publicCode);
    expect(a).toMatchObject({ kind: 'ok', conversationId: mine.id });
    expect(b).toMatchObject({ kind: 'ok', conversationId: null });
    const guest = await service.profile(other.id, withChat.c.publicCode);
    expect(guest).toMatchObject({ kind: 'ok', conversationId: null });
  });
});
