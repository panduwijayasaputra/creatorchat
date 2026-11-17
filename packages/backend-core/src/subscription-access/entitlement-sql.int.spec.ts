import { CreatorListQuerySchema, UserListQuerySchema } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { createTestPrisma, loadRootEnv, resetDatabase } from '@creatorchat/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CreatorDetailService } from '../creator-detail/creator-detail.service.js';
import { CreatorListService } from '../creator-list/creator-list.service.js';
import { UserDetailService } from '../user-detail/user-detail.service.js';
import { UserListService } from '../user-list/user-list.service.js';
import { isEntitled } from './entitlement.js';
import {
  countEntitledForCustomer,
  countEntitledSubscribers,
  entitledSubscriptionSql,
  nearestEntitledEnd,
  ENTITLED_FROM,
} from './entitlement-sql.js';

loadRootEnv();
const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-16T08:00:00.000Z');
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);

let tg = 600_000n;
let code = 0;
const user = (name: string, data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { telegramId: tg++, displayName: name, ...data } });
async function creator(
  name: string,
  data: { status?: 'ACTIVE' | 'BLOCKED'; userStatus?: 'ACTIVE' | 'BLOCKED' } = {},
) {
  const u = await user(name, { role: 'CREATOR', status: data.userStatus ?? 'ACTIVE' });
  const c = await prisma.creator.create({
    data: {
      userId: u.id,
      publicCode: `ent${'abcdefgh'[code++ % 8]}${'abcdefgh'[Math.floor(code / 8) % 8]}bbb`.slice(
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

beforeEach(async () => {
  code = 0;
  await resetDatabase(prisma);
});
afterAll(() => prisma.$disconnect());

describe('one entitlement rule for every count', () => {
  it('the creator list, creator detail, user list and user detail agree', async () => {
    const salsa = await creator('Salsa');
    const blockedCreator = await creator('Citra', { status: 'BLOCKED' });
    const [a, b, c, d, e, f] = await Promise.all(
      ['a', 'b', 'c', 'd', 'e']
        .map((n) => user(n))
        .concat([user('blocked-customer', { status: 'BLOCKED' })]),
    );
    await sub(a!.id, salsa.c.id, -5, 5); // entitled
    await sub(b!.id, salsa.c.id, -9, -1); // expired
    await sub(c!.id, salsa.c.id, -5, 5, { revokedAt: NOW }); // revoked
    await sub(d!.id, salsa.c.id, 2, 9); // not started
    await sub(f!.id, salsa.c.id, -5, 5); // blocked customer
    await sub(a!.id, blockedCreator.c.id, -5, 5); // blocked creator
    await sub(e!.id, salsa.c.id, -1, 20); // entitled
    const clock = () => NOW;

    const list = await new CreatorListService(prisma, { clock }).list(
      CreatorListQuerySchema.parse({ page_size: '50' }),
    );
    const bySalsa = list.items.find((i) => i.id === salsa.c.id);
    const byCitra = list.items.find((i) => i.id === blockedCreator.c.id);
    expect(bySalsa?.subscriber_count).toBe(2);
    expect(byCitra?.subscriber_count).toBe(0);

    const details = new CreatorDetailService(prisma, { clock });
    expect((await details.get(salsa.c.id))?.detail.creator?.subscriber_count).toBe(2);
    expect((await details.get(blockedCreator.c.id))?.detail.creator?.subscriber_count).toBe(0);
    expect(await countEntitledSubscribers(prisma, salsa.c.id, NOW)).toBe(2);
    // The moderation dialogs count around a status change: account statuses are not part of it.
    expect(
      await countEntitledSubscribers(prisma, blockedCreator.c.id, NOW, {
        ignoreAccountStatus: true,
      }),
    ).toBe(1);

    const users = await new UserListService(prisma, { clock }).list(
      UserListQuerySchema.parse({ page_size: '50' }),
    );
    const subsOf = (id: string) => users.items.find((i) => i.id === id)?.active_subscription_count;
    expect(subsOf(a!.id)).toBe(1); // Salsa counts, the blocked creator does not
    expect(subsOf(b!.id)).toBe(0);
    expect(subsOf(f!.id)).toBe(0); // a blocked customer is not entitled
    expect(subsOf(e!.id)).toBe(1);

    const userDetails = new UserDetailService(prisma, { clock });
    for (const [u, expected] of [
      [a!, 1],
      [b!, 0],
      [f!, 0],
      [e!, 1],
    ] as const) {
      const r = (await userDetails.get(u.id)) as { subscriptions: { active_count: number } };
      expect(r.subscriptions.active_count).toBe(expected);
      expect(await countEntitledForCustomer(prisma, u.id, NOW)).toBe(expected);
    }
    expect((await nearestEntitledEnd(prisma, a!.id, NOW))?.creatorName).toBe('Salsa');
    expect(await nearestEntitledEnd(prisma, f!.id, NOW)).toBeNull();
  });

  it('the SQL predicate and isEntitled agree on dates and revocation', async () => {
    const { c } = await creator('Salsa');
    const grid: [number, number, boolean][] = [
      [-5, 5, false],
      [-5, 0, false],
      [0, 5, false],
      [1, 5, false],
      [-5, -1, false],
      [-5, 5, true],
    ];
    for (const [i, [s, e, revoked]] of grid.entries()) {
      const customer = await user(`c${i}`);
      const row = await sub(customer.id, c.id, s, e, revoked ? { revokedAt: NOW } : {});
      const rows = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${ENTITLED_FROM} WHERE s.id = ${row.id}::uuid AND ${entitledSubscriptionSql(NOW)}`;
      expect(rows[0]?.n === 1, `${s}/${e}/${revoked}`).toBe(isEntitled(row, NOW));
    }
  });

  it('the approval block and the request mark still count a future subscription', async () => {
    const { c } = await creator('Salsa');
    const applicant = await user('Raka');
    await sub(applicant.id, c.id, 3, 10);
    await prisma.creatorApplication.create({
      data: {
        userId: applicant.id,
        creatorName: 'R',
        instagramUrl: 'https://instagram.com/r',
        creatorType: 'HUMAN',
        description: 'd',
      },
    });
    const list = await new CreatorListService(prisma, { clock: () => NOW }).list(
      CreatorListQuerySchema.parse({ status: 'request' }),
    );
    expect(list.items[0]?.has_active_subscription).toBe(true);
    expect(await countEntitledForCustomer(prisma, applicant.id, NOW)).toBe(0);
  });
});
