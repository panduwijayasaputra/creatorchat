import type { SubmitCreatorRequestData } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CreatorRequestAccountNotActiveError,
  CreatorRequestBlockedError,
  CreatorRequestService,
} from './creator-request.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T05:00:00Z');
const service = new CreatorRequestService(prisma, () => NOW);

let n = 8000n;
const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Maya Lestari', ...data } });
let codeNo = 0;
const makeCreator = async (name = 'Salsa Maheswari') => {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: name, role: 'CREATOR' },
  });
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const code = `${letters[codeNo % 26]}${letters[Math.floor(codeNo / 26) % 26]}aaaaaa`;
  codeNo += 1;
  return prisma.creator.create({ data: { userId: user.id, publicCode: code } });
};
const subscribe = (
  customerId: string,
  creatorId: string,
  startsAt: string,
  endsAt: string,
  extra = {},
) =>
  prisma.subscription.create({
    data: {
      customerId,
      creatorId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      ...extra,
    },
  });
const input = (over: Partial<SubmitCreatorRequestData> = {}): SubmitCreatorRequestData => ({
  creator_name: 'Maya Lestari',
  instagram_url: 'https://instagram.com/maya',
  creator_type: 'HUMAN',
  description: 'Resep dan tips masak rumahan.',
  rights_confirmed: true,
  ...over,
});

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('CreatorRequestService.submit', () => {
  it('stores a PENDING request, keeps the account as it was and writes one audit row', async () => {
    const user = await makeUser();
    const result = await service.submit(user.id, input({ creator_type: 'AI_CHARACTER' }));
    expect(result).toMatchObject({
      status: 'PENDING',
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya',
      creator_type: 'AI_CHARACTER',
      reviewed_at: null,
      review_reason: null,
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({
      role: 'USER',
      status: 'ACTIVE',
      sessionVersion: user.sessionVersion,
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'creator.application.submitted' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'USER',
      actorId: user.id,
      targetType: 'creator_application',
      targetId: result.id,
    });
    expect(JSON.stringify(audit[0]?.changes)).not.toContain('instagram');
  });

  it('returns the existing pending request on a repeat submit, writing nothing', async () => {
    const user = await makeUser();
    const first = await service.submit(user.id, input());
    const second = await service.submit(user.id, input({ creator_name: 'Other' }));
    expect(second.id).toBe(first.id);
    expect(second.creator_name).toBe('Maya Lestari');
    expect(await prisma.creatorApplication.count()).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'creator.application.submitted' } }),
    ).toBe(1);
  });

  it('creates one row when the same user submits five times at once', async () => {
    const user = await makeUser();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.submit(user.id, input())),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.creatorApplication.count({ where: { userId: user.id } })).toBe(1);
  });

  it('creates a new request after a rejection and leaves the rejected one unchanged', async () => {
    const user = await makeUser();
    const old = await prisma.creatorApplication.create({
      data: {
        userId: user.id,
        creatorName: 'Maya',
        instagramUrl: 'https://instagram.com/old',
        creatorType: 'HUMAN',
        description: 'lama',
        status: 'REJECTED',
        reviewedAt: new Date('2026-11-10T00:00:00Z'),
        reviewReason: 'Link tidak valid',
      },
    });
    const fresh = await service.submit(user.id, input());
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.status).toBe('PENDING');
    const kept = await prisma.creatorApplication.findUniqueOrThrow({ where: { id: old.id } });
    expect(kept).toMatchObject({
      status: 'REJECTED',
      reviewReason: 'Link tidak valid',
      description: 'lama',
    });
  });

  it('refuses while a customer subscription is active, changing nothing', async () => {
    const user = await makeUser();
    const creator = await makeCreator();
    const sub = await subscribe(
      user.id,
      creator.id,
      '2026-11-01T00:00:00Z',
      '2026-11-27T00:00:00Z',
    );
    const error = await service.submit(user.id, input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CreatorRequestBlockedError);
    expect((error as CreatorRequestBlockedError).block).toEqual({
      creator_name: 'Salsa Maheswari',
      ends_at: '2026-11-27T00:00:00.000Z',
    });
    expect(await prisma.creatorApplication.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.updatedAt).toEqual(sub.updatedAt);
    expect(after.revokedAt).toBeNull();
  });

  it('also refuses for a subscription that starts in the future', async () => {
    const user = await makeUser();
    const creator = await makeCreator();
    await subscribe(user.id, creator.id, '2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z');
    await expect(service.submit(user.id, input())).rejects.toBeInstanceOf(
      CreatorRequestBlockedError,
    );
  });

  it('is not blocked by an ended or a revoked subscription', async () => {
    const user = await makeUser();
    const a = await makeCreator('A');
    const b = await makeCreator('B');
    await subscribe(user.id, a.id, '2026-10-01T00:00:00Z', '2026-11-16T05:00:00Z');
    await subscribe(user.id, b.id, '2026-11-01T00:00:00Z', '2026-12-31T00:00:00Z', {
      revokedAt: new Date('2026-11-10T00:00:00Z'),
    });
    expect((await service.submit(user.id, input())).status).toBe('PENDING');
  });

  it('reports the subscription that ends last when there are several', async () => {
    const user = await makeUser();
    const a = await makeCreator('Salsa');
    const b = await makeCreator('Kirana');
    await subscribe(user.id, a.id, '2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z');
    await subscribe(user.id, b.id, '2026-11-01T00:00:00Z', '2026-12-05T00:00:00Z');
    const error = await service.submit(user.id, input()).catch((e: unknown) => e);
    expect((error as CreatorRequestBlockedError).block).toEqual({
      creator_name: 'Kirana',
      ends_at: '2026-12-05T00:00:00.000Z',
    });
  });

  it('returns the existing pending request even if a subscription appeared since', async () => {
    const user = await makeUser();
    const first = await service.submit(user.id, input());
    const creator = await makeCreator();
    await subscribe(user.id, creator.id, '2026-11-01T00:00:00Z', '2026-11-27T00:00:00Z');
    expect((await service.submit(user.id, input())).id).toBe(first.id);
  });

  it.each([
    ['a blocked user', { status: 'BLOCKED' }],
    ['a creator', { role: 'CREATOR' }],
  ])('rejects %s and writes nothing', async (_label, data) => {
    const user = await makeUser(data);
    await expect(service.submit(user.id, input())).rejects.toBeInstanceOf(
      CreatorRequestAccountNotActiveError,
    );
    expect(await prisma.creatorApplication.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rejects an unknown user id', async () => {
    await expect(
      service.submit('00000000-0000-4000-8000-000000000000', input()),
    ).rejects.toBeInstanceOf(CreatorRequestAccountNotActiveError);
  });
});

describe('CreatorRequestService.getState', () => {
  it('is empty for a fresh user', async () => {
    const user = await makeUser();
    expect(await service.getState(user.id)).toEqual({ request: null, blocked: null });
  });

  it('returns the latest request and only the caller own data', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await prisma.creatorApplication.create({
      data: {
        userId: a.id,
        creatorName: 'Old',
        instagramUrl: 'https://instagram.com/old',
        creatorType: 'HUMAN',
        description: 'x',
        status: 'REJECTED',
        reviewedAt: new Date('2026-11-01T00:00:00Z'),
        reviewReason: 'Alasan',
        createdAt: new Date('2026-10-30T00:00:00Z'),
      },
    });
    const latest = await service.submit(a.id, input());
    await service.submit(b.id, input({ creator_name: 'Bee' }));
    const state = await service.getState(a.id);
    expect(state.request?.id).toBe(latest.id);
    expect(state.request?.creator_name).toBe('Maya Lestari');
    expect(state.blocked).toBeNull();
  });

  it('reports the blocking subscription and nothing for another customer', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const creator = await makeCreator();
    await subscribe(a.id, creator.id, '2026-11-01T00:00:00Z', '2026-11-27T00:00:00Z');
    expect((await service.getState(a.id)).blocked).toEqual({
      creator_name: 'Salsa Maheswari',
      ends_at: '2026-11-27T00:00:00.000Z',
    });
    expect((await service.getState(b.id)).blocked).toBeNull();
  });
});
