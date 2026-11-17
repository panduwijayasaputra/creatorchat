import { Prisma, type PrismaClient } from '@creatorchat/db';

/**
 * The one read-side entitlement rule (brief §6, US-021): a subscription counts as access while it is
 * not revoked, `starts_at <= now < ends_at`, the customer is an ACTIVE USER, and the creator and the
 * creator's account are ACTIVE. `isEntitled` is the date and revocation part of the same rule.
 *
 * Aliases used by the predicate: `s` (subscriptions), `cu` (customer user), `sc` (creator row of the
 * subscription), `ou` (the creator's user). Use `ENTITLED_FROM` to bring them into scope.
 */
export const ENTITLED_FROM = Prisma.sql`subscriptions s
  JOIN users cu ON cu.id = s.customer_id
  JOIN creators sc ON sc.id = s.creator_id
  JOIN users ou ON ou.id = sc.user_id`;

export function entitledSubscriptionSql(
  now: Date,
  options: { ignoreAccountStatus?: boolean } = {},
): Prisma.Sql {
  const window = Prisma.sql`s.revoked_at IS NULL AND s.starts_at <= ${now}::timestamptz AND s.ends_at > ${now}::timestamptz`;
  if (options.ignoreAccountStatus) return window;
  return Prisma.sql`${window} AND cu.status = 'ACTIVE' AND cu.role = 'USER' AND sc.status = 'ACTIVE' AND ou.status = 'ACTIVE'`;
}

type Db = Pick<PrismaClient, '$queryRaw'>;

/** Entitled subscriptions of one creator (the "Subscriber aktif" number). */
export async function countEntitledSubscribers(
  db: Db,
  creatorId: string,
  now: Date,
  options: { ignoreAccountStatus?: boolean } = {},
): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${ENTITLED_FROM}
    WHERE s.creator_id = ${creatorId}::uuid AND ${entitledSubscriptionSql(now, options)}`;
  return rows[0]?.n ?? 0;
}

/** Entitled subscriptions of one customer (the "Langganan aktif" number). */
export async function countEntitledForCustomer(
  db: Db,
  userId: string,
  now: Date,
  options: { ignoreAccountStatus?: boolean } = {},
): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${ENTITLED_FROM}
    WHERE s.customer_id = ${userId}::uuid AND ${entitledSubscriptionSql(now, options)}`;
  return rows[0]?.n ?? 0;
}

/** The entitled subscription of a customer that ends first ("Terdekat berakhir"). */
export async function nearestEntitledEnd(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ creatorName: string; endsAt: Date } | null> {
  const rows = await db.$queryRaw<{ name: string; ends_at: Date }[]>`
    SELECT ou.display_name AS name, s.ends_at FROM ${ENTITLED_FROM}
    WHERE s.customer_id = ${userId}::uuid AND ${entitledSubscriptionSql(now)}
    ORDER BY s.ends_at ASC, s.id LIMIT 1`;
  const row = rows[0];
  return row ? { creatorName: row.name, endsAt: row.ends_at } : null;
}
