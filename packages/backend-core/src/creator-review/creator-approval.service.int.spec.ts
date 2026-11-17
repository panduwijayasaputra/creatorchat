import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountSecurityService } from '../account-security/account-security.service.js';
import {
  CreatorRequestAccountNotActiveError,
  CreatorRequestService,
} from '../creator-request/creator-request.service.js';
import { CreatorApprovalService } from './creator-approval.service.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const security = new AccountSecurityService(prisma);
const NOW = new Date('2026-11-16T08:02:00.000Z');
const DAY = 86_400_000;
const service = new CreatorApprovalService(prisma, security, { clock: () => NOW });

let n = 20_000n;
let codeNo = 0;
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

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: n++, displayName: 'Maya L', ...data } });

const makeCreator = async (name = 'Salsa Maheswari') => {
  const user = await prisma.user.create({
    data: { telegramId: n++, displayName: name, role: 'CREATOR' },
  });
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const code = `${letters[codeNo % 26]}${letters[Math.floor(codeNo / 26) % 26]}bbbbbb`;
  codeNo += 1;
  return prisma.creator.create({ data: { userId: user.id, publicCode: code } });
};

const makeRequest = async (
  options: { user?: Record<string, unknown>; app?: Record<string, unknown> } = {},
) => {
  const user = await makeUser(options.user);
  const application = await prisma.creatorApplication.create({
    data: {
      userId: user.id,
      creatorName: 'Maya Lestari',
      instagramUrl: 'https://instagram.com/maya.lestari',
      creatorType: 'AI_CHARACTER',
      description: 'Resep dan tips masak rumahan.',
      ...options.app,
    },
  });
  return { user, application };
};

const subscribe = async (
  customerId: string,
  startsInDays: number,
  endsInDays: number,
  extra = {},
) => {
  const creator = await makeCreator();
  return prisma.subscription.create({
    data: {
      customerId,
      creatorId: creator.id,
      startsAt: new Date(NOW.getTime() + startsInDays * DAY),
      endsAt: new Date(NOW.getTime() + endsInDays * DAY),
      ...extra,
    },
  });
};

const ctx = () => ({ adminId, requestId: 'req-test-1' });
const snapshot = async (userId: string, applicationId: string) => ({
  user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  application: await prisma.creatorApplication.findUniqueOrThrow({ where: { id: applicationId } }),
  creators: await prisma.creator.count({ where: { userId } }),
  outbox: await prisma.outboxEvent.count(),
  audit: await prisma.auditLog.count(),
});

describe('approve', () => {
  it('converts the same account: role, version, sessions, creator row, name, audit and one outbox event', async () => {
    const { user, application } = await makeRequest();
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionVersion: user.sessionVersion,
        expiresAt: new Date(NOW.getTime() + DAY),
      },
    });

    const result = await service.approve(application.id, ctx());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.id).toBe(user.id);
    expect(after.telegramId).toBe(user.telegramId);
    expect(after).toMatchObject({ role: 'CREATOR', status: 'ACTIVE', displayName: 'Maya Lestari' });
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt,
    ).not.toBeNull();

    const creator = await prisma.creator.findUniqueOrThrow({ where: { userId: user.id } });
    expect(creator).toMatchObject({
      status: 'ACTIVE',
      creatorType: 'AI_CHARACTER',
      instagramUrl: 'https://instagram.com/maya.lestari',
    });
    expect(creator.publicCode).toMatch(/^[a-z2-7]{8}$/);
    expect(result.creator).toEqual({ id: creator.id, publicCode: creator.publicCode });

    const reviewed = await prisma.creatorApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(reviewed).toMatchObject({
      status: 'APPROVED',
      reviewedByAdminId: adminId,
      reviewReason: null,
    });
    expect(reviewed.reviewedAt?.toISOString()).toBe(NOW.toISOString());
    expect(result.request).toMatchObject({
      status: 'APPROVED',
      user: { id: user.id, role: 'CREATOR' },
    });

    const audits = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'creator.application.approved',
      'user.role.changed',
    ]);
    const approved = audits.find((a) => a.action === 'creator.application.approved');
    expect(approved).toMatchObject({
      actorType: 'ADMIN',
      actorId: adminId,
      targetId: application.id,
      requestId: 'req-test-1',
    });
    expect(approved?.changes).toMatchObject({
      public_code: creator.publicCode,
      display_name: ['Maya L', 'Maya Lestari'],
    });

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'creator_application.approved',
      status: 'PENDING',
      dedupeKey: `creator_application:${application.id}:decision`,
      payload: { application_id: application.id, user_id: user.id, decision: 'approved' },
    });
  });

  it('refuses unknown and malformed ids', async () => {
    expect(await service.approve('0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33', ctx())).toEqual({
      kind: 'not_found',
    });
    expect(await service.approve('not-a-uuid', ctx())).toEqual({ kind: 'not_found' });
    expect(await service.approve("1'; DROP TABLE users;--", ctx())).toEqual({ kind: 'not_found' });
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'refuses a request that is already %s and changes nothing',
    async (status) => {
      const { user, application } = await makeRequest({
        app: { status, reviewedAt: NOW, ...(status === 'REJECTED' ? { reviewReason: 'x' } : {}) },
      });
      const before = await snapshot(user.id, application.id);
      expect(await service.approve(application.id, ctx())).toEqual({
        kind: 'already_reviewed',
        status,
      });
      expect(await snapshot(user.id, application.id)).toEqual(before);
    },
  );

  it('refuses a BLOCKED account and an account that is already a creator', async () => {
    const blocked = await makeRequest({ user: { status: 'BLOCKED' } });
    const before = await snapshot(blocked.user.id, blocked.application.id);
    expect(await service.approve(blocked.application.id, ctx())).toEqual({ kind: 'not_eligible' });
    expect(await snapshot(blocked.user.id, blocked.application.id)).toEqual(before);

    const creator = await makeRequest({ user: { role: 'CREATOR' } });
    expect(await service.approve(creator.application.id, ctx())).toEqual({ kind: 'not_eligible' });
    expect(await prisma.creator.count()).toBe(0);
  });

  it('refuses an active subscription with the creator and end date, changing nothing', async () => {
    const { user, application } = await makeRequest();
    const sub = await subscribe(user.id, -5, 10);
    const before = await snapshot(user.id, application.id);
    const result = await service.approve(application.id, ctx());
    expect(result).toEqual({
      kind: 'blocked',
      block: { count: 1, creator_name: 'Salsa Maheswari', ends_at: sub.endsAt.toISOString() },
    });
    expect(await snapshot(user.id, application.id)).toEqual(before);
    expect(before.user.role).toBe('USER');
  });

  it('refuses a future subscription too, but not an ended or a revoked one', async () => {
    const future = await makeRequest();
    await subscribe(future.user.id, 3, 30);
    expect((await service.approve(future.application.id, ctx())).kind).toBe('blocked');

    const done = await makeRequest();
    await subscribe(done.user.id, -30, -1);
    await subscribe(done.user.id, -5, 20, { revokedAt: NOW });
    expect((await service.approve(done.application.id, ctx())).kind).toBe('ok');
  });

  it('counts several subscriptions and names the one that ends last', async () => {
    const { user, application } = await makeRequest();
    await subscribe(user.id, -5, 5);
    const last = await subscribe(user.id, -1, 40);
    const result = await service.approve(application.id, ctx());
    expect(result).toMatchObject({
      kind: 'blocked',
      block: { count: 2, ends_at: last.endsAt.toISOString() },
    });
  });

  it('keeps the application PENDING and the role USER when a later step fails', async () => {
    const failing = new CreatorApprovalService(prisma, security, {
      clock: () => NOW,
      generateCode: () => 'INVALID!', // violates the creators_public_code_format_chk CHECK
    });
    const { user, application } = await makeRequest();
    const before = await snapshot(user.id, application.id);
    await expect(failing.approve(application.id, ctx())).rejects.toThrow();
    expect(await snapshot(user.id, application.id)).toEqual(before);
    expect(before.application.status).toBe('PENDING');
  });

  it('retries with a new code when the generated one is taken', async () => {
    const taken = await makeCreator();
    const codes = [taken.publicCode, taken.publicCode, 'abcdefg2'];
    const withCollision = new CreatorApprovalService(prisma, security, {
      clock: () => NOW,
      generateCode: () => codes.shift() ?? 'zzzzzzz7',
    });
    const { user, application } = await makeRequest();
    const result = await withCollision.approve(application.id, ctx());
    expect(result.kind).toBe('ok');
    expect(
      (await prisma.creator.findUniqueOrThrow({ where: { userId: user.id } })).publicCode,
    ).toBe('abcdefg2');
  });

  it('gives up with an error, writing nothing, when every code collides', async () => {
    const taken = await makeCreator();
    const stuck = new CreatorApprovalService(prisma, security, {
      clock: () => NOW,
      generateCode: () => taken.publicCode,
    });
    const { user, application } = await makeRequest();
    const before = await snapshot(user.id, application.id);
    await expect(stuck.approve(application.id, ctx())).rejects.toThrow(/unique creator code/);
    expect(await snapshot(user.id, application.id)).toEqual(before);
  });
});

describe('reject', () => {
  it('records the reason, admin and time, keeps the role, writes audit and one outbox event', async () => {
    const { user, application } = await makeRequest();
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionVersion: user.sessionVersion,
        expiresAt: new Date(NOW.getTime() + DAY),
      },
    });
    const reason = 'Link Instagram belum bisa kami verifikasi.';
    const result = await service.reject(application.id, { reason }, ctx());
    expect(result.kind).toBe('ok');

    const reviewed = await prisma.creatorApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(reviewed).toMatchObject({
      status: 'REJECTED',
      reviewedByAdminId: adminId,
      reviewReason: reason,
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ role: 'USER', sessionVersion: user.sessionVersion });
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt,
    ).toBeNull();
    expect(await prisma.creator.count()).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'creator.application.rejected' },
    });
    expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: adminId, reason });
    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('creator_application.rejected');
    // The outbox payload carries ids only, never the reason text.
    expect(JSON.stringify(events[0]?.payload)).not.toContain('Instagram');
  });

  it('can reject a BLOCKED applicant, but not twice and not an unknown id', async () => {
    const { application } = await makeRequest({ user: { status: 'BLOCKED' } });
    expect((await service.reject(application.id, { reason: 'x' }, ctx())).kind).toBe('ok');
    expect(await service.reject(application.id, { reason: 'y' }, ctx())).toEqual({
      kind: 'already_reviewed',
      status: 'REJECTED',
    });
    expect(
      await service.reject('0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33', { reason: 'x' }, ctx()),
    ).toEqual({ kind: 'not_found' });
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('lets the user apply again after a rejection and leaves the rejected row alone', async () => {
    const { user, application } = await makeRequest();
    await service.reject(application.id, { reason: 'Belum jelas.' }, ctx());
    const requests = new CreatorRequestService(prisma, () => NOW);
    const again = await requests.submit(user.id, {
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya.lestari',
      creator_type: 'HUMAN',
      description: 'Lebih jelas.',
      rights_confirmed: true,
    });
    expect(again.id).not.toBe(application.id);
    expect(
      (await prisma.creatorApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe('REJECTED');
  });
});

describe('concurrent decisions', () => {
  it('two approves at once: one wins, one creator row, one outbox event', async () => {
    const { user, application } = await makeRequest();
    const results = await Promise.all([
      service.approve(application.id, ctx()),
      service.approve(application.id, ctx()),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(['already_reviewed', 'ok']);
    expect(await prisma.creator.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(
      user.sessionVersion + 1,
    );
  });

  it('approve and reject at once: exactly one decision is recorded', async () => {
    const { user, application } = await makeRequest();
    const [approved, rejected] = await Promise.all([
      service.approve(application.id, ctx()),
      service.reject(application.id, { reason: 'Tidak sesuai.' }, ctx()),
    ]);
    expect([approved.kind, rejected.kind].sort()).toEqual(['already_reviewed', 'ok']);
    expect(await prisma.outboxEvent.count()).toBe(1);
    const row = await prisma.creatorApplication.findUniqueOrThrow({
      where: { id: application.id },
    });
    const role = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role;
    expect(row.status === 'APPROVED' ? role === 'CREATOR' : role === 'USER').toBe(true);
    expect(await prisma.creator.count({ where: { userId: user.id } })).toBe(
      row.status === 'APPROVED' ? 1 : 0,
    );
  });

  it('approve and a submit of the same user serialise without a second request or an error loop', async () => {
    const { user, application } = await makeRequest();
    const requests = new CreatorRequestService(prisma, () => NOW);
    const [approved, submitted] = await Promise.allSettled([
      service.approve(application.id, ctx()),
      requests.submit(user.id, {
        creator_name: 'Maya Lestari',
        instagram_url: 'https://instagram.com/maya.lestari',
        creator_type: 'HUMAN',
        description: 'Lagi.',
        rights_confirmed: true,
      }),
    ]);
    expect(approved.status === 'fulfilled' && approved.value.kind === 'ok').toBe(true);
    if (submitted.status === 'rejected') {
      expect(submitted.reason).toBeInstanceOf(CreatorRequestAccountNotActiveError);
    }
    expect(await prisma.creatorApplication.count({ where: { userId: user.id } })).toBe(1);
  });

  it('approve and a block of the same account serialise: no creator for a blocked account', async () => {
    const { user, application } = await makeRequest();
    const [approved] = await Promise.all([
      service.approve(application.id, ctx()),
      security.blockUser(user.id),
    ]);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('BLOCKED');
    if (approved.kind === 'ok') expect(after.role).toBe('CREATOR');
    else expect(approved.kind).toBe('not_eligible');
  });
});

describe('getForReview', () => {
  it('returns the request, the applicant and the pre-check time', async () => {
    const { user, application } = await makeRequest({
      user: { telegramUsername: 'mayalestari' },
    });
    const view = await service.getForReview(application.id);
    expect(view?.request).toMatchObject({
      id: application.id,
      status: 'PENDING',
      creator_name: 'Maya Lestari',
      user: {
        id: user.id,
        display_name: 'Maya L',
        telegram_username: 'mayalestari',
        telegram_id: user.telegramId.toString(),
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    expect(view?.check).toEqual({ block: null, checkedAt: NOW });
  });

  it('shows the blocking subscription and nothing for unknown or malformed ids', async () => {
    const { user, application } = await makeRequest();
    const sub = await subscribe(user.id, -5, 10);
    expect((await service.getForReview(application.id))?.check.block).toEqual({
      count: 1,
      creator_name: 'Salsa Maheswari',
      ends_at: sub.endsAt.toISOString(),
    });
    expect(await service.getForReview('0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33')).toBeNull();
    expect(await service.getForReview('nope')).toBeNull();
  });
});

describe('a request that was not approved never changes the role', () => {
  it('leaves a pending and a rejected request at USER', async () => {
    const pending = await makeRequest();
    const rejected = await makeRequest();
    await service.reject(rejected.application.id, { reason: 'x' }, ctx());
    for (const { user } of [pending, rejected]) {
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('USER');
    }
    expect(await prisma.creator.count()).toBe(0);
  });
});
