import type { ApprovalBlock } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';

/**
 * The customer subscriptions that stop a user from becoming a creator: not revoked and not yet
 * ended, so both active and future ones count. With several, the one that ends last decides when the
 * user may apply. Used by the request form (US-010) and, inside the transaction, by the approval.
 */
export async function findSubscriptionBlock(
  db: Pick<PrismaClient, 'subscription'>,
  userId: string,
  now: Date,
): Promise<ApprovalBlock | null> {
  const where = { customerId: userId, revokedAt: null, endsAt: { gt: now } };
  const row = await db.subscription.findFirst({
    where,
    orderBy: { endsAt: 'desc' },
    select: { endsAt: true, creator: { select: { user: { select: { displayName: true } } } } },
  });
  if (!row) return null;
  return {
    count: await db.subscription.count({ where }),
    creator_name: row.creator.user.displayName,
    ends_at: row.endsAt.toISOString(),
  };
}
